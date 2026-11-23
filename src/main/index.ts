import { app, BrowserWindow, dialog, ipcMain, protocol, shell, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import type {
  AppState,
  Clip,
  ClipJobPayload,
  CreateJobOptions,
  Job,
  LayoutConfig,
  Moment,
  RenderRequest,
  Settings,
  SubtitleStyle
} from '../shared/types'
import { DEFAULT_LAYOUT, PLATFORM_LABELS, defaultLayoutFor } from '../shared/defaults'
import { Store } from './store'
import { ensureDir, fileExists, humanBytes, safeName } from './core/media'
import { detectSourceType, ensureYtDlp, ytDlpVersion } from './core/ytdlp'
import {
  clipFileName,
  initSteps,
  runAnalysis,
  runPipeline,
  transcribeJob,
  type PipelineDirs,
  type PipelineHooks
} from './core/pipeline'
import { renderClip, renderPreviewFrame } from './core/render/render'
import { extractFrame } from './core/media'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'clipmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.srt': 'text/plain',
  '.vtt': 'text/vtt',
  '.ass': 'text/plain'
}

let mainWindow: BrowserWindow | null = null
let store: Store
let workRoot = ''
let binDir = ''
let manager: JobManager

function userError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  throw new Error(message.replace(/^Error:\s*/, ''))
}

class JobManager {
  private running = new Map<string, AbortController>()
  private emitState = new Map<string, { last: number; timer?: NodeJS.Timeout }>()

  constructor(private readonly db: Store) {}

  dirs(): PipelineDirs {
    return {
      workDir: '',
      binDir,
      outputDir: this.db.getSettings().outputDir
    }
  }

  private dirsFor(job: Job): PipelineDirs {
    return {
      workDir: path.join(workRoot, job.id),
      binDir,
      outputDir: this.db.getSettings().outputDir
    }
  }

  private send(job: Job): void {
    const payload = JSON.parse(JSON.stringify(job)) as Job
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('job:update', payload)
    }
  }

  emit(job: Job): void {
    if (!this.db.getJob(job.id)) return
    this.db.scheduleSave()
    const now = Date.now()
    const state = this.emitState.get(job.id)
    if (!state) {
      this.emitState.set(job.id, { last: now })
      this.send(job)
      return
    }
    if (now - state.last >= 120) {
      state.last = now
      this.send(job)
      return
    }
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.last = Date.now()
        state.timer = undefined
        this.send(job)
      }, 120)
    }
  }

  toast(message: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('app:toast', message)
    }
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId) || this.running.has(`render:${jobId}`)
  }

  createJob(payload: ClipJobPayload, options: CreateJobOptions = {}): Job {
    const settings = this.db.getSettings()
    const id = crypto.randomUUID()
    const layoutId = options.layoutId ?? settings.clipDefaults.layoutId
    const layout = defaultLayoutFor(layoutId, 16 / 9)
    const count = clampNumber(options.count ?? settings.clipDefaults.count, 1, 20, 8)
    const minDuration = clampNumber(options.minDuration ?? settings.clipDefaults.minDuration, 5, 120, 15)
    const maxDuration = clampNumber(
      options.maxDuration ?? settings.clipDefaults.maxDuration,
      minDuration + 3,
      300,
      60
    )

    const isFile = payload.kind === 'file'
    const sourceUrl = isFile ? undefined : payload.url.trim()
    const filePath = isFile ? payload.filePath : undefined
    if (!isFile && !/^https?:\/\//i.test(sourceUrl ?? '')) {
      throw new Error('Вставте коректне посилання на YouTube або Twitch')
    }
    if (isFile && (!filePath || !fileExists(filePath))) {
      throw new Error('Відеофайл не знайдено')
    }

    const job: Job = {
      id,
      title: isFile ? path.basename(filePath!, path.extname(filePath!)) : 'Нове відео',
      sourceType: isFile ? 'file' : detectSourceType(sourceUrl!),
      sourceUrl,
      filePath,
      videoPath: isFile ? filePath : undefined,
      duration: 0,
      width: 0,
      height: 0,
      fps: 0,
      createdAt: Date.now(),
      status: 'queued',
      progress: 0,
      progressLabel: 'У черзі',
      steps: [],
      clipOptions: { count, minDuration, maxDuration },
      transcript: [],
      moments: [],
      clips: [],
      layout,
      subtitle: options.subtitle ?? { ...settings.clipDefaults.subtitle },
      logs: [],
      aiUsed: false
    }
    initSteps(job)
    ensureDir(this.dirsFor(job).workDir)
    this.db.addJob(job)
    this.emit(job)
    void this.start(job)
    return job
  }

  private hooks(job: Job, controller: AbortController): PipelineHooks {
    return {
      update: (j) => this.emit(j),
      log: () => {
        /* логи пишуться в job.logs усередині пайплайну */
      },
      signal: controller.signal
    }
  }

  async start(job: Job): Promise<void> {
    if (this.running.has(job.id)) return
    const controller = new AbortController()
    this.running.set(job.id, controller)
    const dirs = this.dirsFor(job)
    initSteps(job)
    try {
      await runPipeline(job, this.db.getSettings(), dirs, this.hooks(job, controller))
    } catch (err) {
      const message = (err as Error).message || 'Невідома помилка'
      job.status = 'error'
      job.error = message
      job.progressLabel = 'Помилка'
      const active = job.steps.find((s) => s.status === 'active')
      if (active) {
        active.status = 'error'
        active.detail = message.slice(0, 160)
      }
      job.logs.push(`[${new Date().toLocaleTimeString('uk-UA', { hour12: false })}] ПОМИЛКА: ${message}`)
      this.emit(job)
      this.toast(message.slice(0, 200))
    } finally {
      this.running.delete(job.id)
      this.emit(job)
    }
  }

  async retry(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    if (this.isRunning(jobId)) throw new Error('Проєкт уже обробляється')
    job.status = 'queued'
    job.progress = 0
    job.progressLabel = 'У черзі'
    job.error = undefined
    job.steps = []
    initSteps(job)
    this.emit(job)
    await this.start(job)
  }

  cancel(jobId: string): void {
    const controller = this.running.get(jobId) ?? this.running.get(`render:${jobId}`)
    if (!controller) return
    controller.abort()
    const job = this.db.getJob(jobId)
    if (job) {
      if (job.status === 'rendering') {
        job.status = 'ready'
        job.progressLabel = 'Рендер скасовано'
      } else {
        job.status = 'canceled'
        job.progressLabel = 'Скасовано'
      }
      this.emit(job)
    }
  }

  delete(jobId: string): void {
    this.cancel(jobId)
    const job = this.db.getJob(jobId)
    if (!job) return
    this.db.removeJob(jobId)
    try {
      fs.rmSync(path.join(workRoot, jobId), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('job:removed', jobId)
    }
  }

  updateJob(jobId: string, patch: Partial<Job>): Job {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    if (typeof patch.title === 'string' && patch.title.trim()) job.title = patch.title.trim().slice(0, 140)
    if (patch.layout) job.layout = sanitizeLayout(patch.layout)
    if (patch.subtitle) job.subtitle = sanitizeSubtitle(patch.subtitle)
    if (patch.clipOptions) {
      const min = clampNumber(patch.clipOptions.minDuration, 5, 120, job.clipOptions.minDuration)
      const max = clampNumber(patch.clipOptions.maxDuration, min + 3, 300, Math.max(min + 3, job.clipOptions.maxDuration))
      job.clipOptions = {
        count: clampNumber(patch.clipOptions.count, 1, 20, job.clipOptions.count),
        minDuration: min,
        maxDuration: max
      }
    }
    this.emit(job)
    return job
  }

  updateMoment(jobId: string, momentId: string, patch: Partial<Moment>): Job {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    const moment = job.moments.find((m) => m.id === momentId)
    if (!moment) throw new Error('Момент не знайдено')
    if (Number.isFinite(patch.start)) moment.start = Math.max(0, Math.min(Number(patch.start), job.duration - 1))
    if (Number.isFinite(patch.end)) moment.end = Math.max(moment.start + 2, Math.min(Number(patch.end), job.duration))
    if (typeof patch.title === 'string') moment.title = patch.title.slice(0, 140)
    if (typeof patch.hook === 'string') moment.hook = patch.hook.slice(0, 140)
    if (typeof patch.reason === 'string') moment.reason = patch.reason.slice(0, 400)
    if (typeof patch.selected === 'boolean') moment.selected = patch.selected
    if (Number.isFinite(patch.score)) moment.score = clampNumber(Number(patch.score), 0, 100, moment.score)
    if (Array.isArray(patch.tags)) moment.tags = patch.tags.map(String).slice(0, 5)
    this.emit(job)
    return job
  }

  addMoment(jobId: string, start: number, end: number): Job {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    const s = Math.max(0, Math.min(start, job.duration - 1))
    const e = Math.min(job.duration, Math.max(s + 2, end))
    const moment: Moment = {
      id: `manual-${crypto.randomUUID()}`,
      start: Math.round(s * 100) / 100,
      end: Math.round(e * 100) / 100,
      score: 100,
      title: `Мій момент ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      hook: '',
      reason: 'Додано вручну',
      tags: [],
      source: 'manual',
      selected: true
    }
    job.moments.push(moment)
    this.emit(job)
    return job
  }

  removeMoment(jobId: string, momentId: string): Job {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    job.moments = job.moments.filter((m) => m.id !== momentId)
    this.emit(job)
    return job
  }

  selectMoments(jobId: string, ids: string[]): Job {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    const set = new Set(ids)
    for (const moment of job.moments) moment.selected = set.has(moment.id)
    this.emit(job)
    return job
  }

  async render(request: RenderRequest): Promise<Clip[]> {
    const job = this.db.getJob(request.jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    if (this.isRunning(job.id)) throw new Error('Дочекайтеся завершення поточної обробки')
    if (!job.videoPath || !fileExists(job.videoPath)) throw new Error('Відеофайл недоступний')

    const moments = job.moments.filter((m) => request.momentIds.includes(m.id))
    if (!moments.length) throw new Error('Не обрано жодного моменту')

    const controller = new AbortController()
    this.running.set(`render:${job.id}`, controller)
    const dirs = this.dirsFor(job)
    const layout = sanitizeLayout(request.layout)
    const subtitle = sanitizeSubtitle(request.subtitle)
    job.layout = layout
    job.subtitle = subtitle
    job.status = 'rendering'
    job.progress = 0
    job.progressLabel = 'Рендер кліпів'
    this.emit(job)

    const outputDir = path.join(this.db.getSettings().outputDir, safeName(job.title).slice(0, 60))
    ensureDir(outputDir)
    const created: Clip[] = []

    try {
      for (let i = 0; i < moments.length; i++) {
        if (controller.signal.aborted) break
        const moment = moments[i]
        const baseName = clipFileName(job, i, moment.title)
        const outPath = uniquePath(outputDir, baseName)
        job.progressLabel = `Рендер ${i + 1}/${moments.length}: ${moment.title.slice(0, 48)}`
        this.emit(job)

        const rendered = await renderClip({
          sourcePath: job.videoPath,
          workDir: dirs.workDir,
          clipStart: moment.start,
          clipEnd: moment.end,
          layout,
          subtitle,
          burnSubtitles: request.burnSubtitles && job.transcript.length > 0,
          transcript: job.transcript,
          outPath,
          log: (line) => {
            job.logs.push(
              `[${new Date().toLocaleTimeString('uk-UA', { hour12: false })}] ${line}`
            )
          },
          onProgress: (pct) => {
            job.progress = Math.round(((i + pct / 100) / moments.length) * 100)
            this.emit(job)
          },
          signal: controller.signal
        })

        const clip: Clip = {
          id: crypto.randomUUID(),
          momentId: moment.id,
          filePath: outPath,
          thumbPath: rendered.thumbPath,
          layoutId: layout.id,
          width: rendered.width,
          height: rendered.height,
          duration: rendered.duration,
          title: moment.title,
          createdAt: Date.now()
        }
        job.clips.unshift(clip)
        created.push(clip)
        this.emit(job)
      }

      job.status = 'ready'
      job.progress = 100
      job.progressLabel =
        created.length === moments.length
          ? `Готово: ${created.length} кліпів`
          : controller.signal.aborted
            ? 'Рендер скасовано'
            : 'Готово'
      job.error = undefined
      const size = created.reduce((n, c) => {
        try {
          return n + fs.statSync(c.filePath).size
        } catch {
          return n
        }
      }, 0)
      job.logs.push(
        `[${new Date().toLocaleTimeString('uk-UA', { hour12: false })}] Створено ${created.length} кліпів (${humanBytes(size)}) у ${outputDir}`
      )
      this.emit(job)
      return created
    } catch (err) {
      job.status = 'ready'
      job.progressLabel = 'Помилка рендеру'
      job.error = (err as Error).message
      this.emit(job)
      userError(err)
    } finally {
      this.running.delete(`render:${job.id}`)
    }
  }

  async preview(request: {
    jobId: string
    layout: LayoutConfig
    subtitle: SubtitleStyle
    burnSubtitles: boolean
    time: number
  }): Promise<string> {
    const job = this.db.getJob(request.jobId)
    if (!job?.videoPath) throw new Error('Немає відео для прев\'ю')
    const dirs = this.dirsFor(job)
    const out = path.join(dirs.workDir, 'layout-preview.png')
    job.layout = sanitizeLayout(request.layout)
    job.subtitle = sanitizeSubtitle(request.subtitle)
    this.emit(job)
    await renderPreviewFrame({
      sourcePath: job.videoPath,
      workDir: dirs.workDir,
      time: Math.max(0, Math.min(request.time, Math.max(0, job.duration - 1))),
      layout: job.layout,
      subtitle: job.subtitle,
      burnSubtitles: request.burnSubtitles && job.transcript.length > 0,
      transcript: job.transcript,
      outPath: out
    })
    return out
  }

  async frame(jobId: string, time: number): Promise<string> {
    const job = this.db.getJob(jobId)
    if (!job?.videoPath) throw new Error('Немає відео')
    const dir = path.join(workRoot, jobId, 'frames')
    ensureDir(dir)
    const out = path.join(dir, `frame-${Math.round(time * 10)}.jpg`)
    if (!fs.existsSync(out)) {
      await extractFrame(job.videoPath, Math.max(0, time), out)
    }
    return out
  }

  async testAi(settings: Settings): Promise<{ ok: boolean; message: string }> {
    const cfg = settings.ai
    if (!cfg.apiKey) return { ok: false, message: 'Додайте API-ключ' }
    if (!cfg.model) return { ok: false, message: 'Вкажіть модель' }
    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Відповідай лише словом OK' }]
        }),
        signal: AbortSignal.timeout(30_000)
      })
      if (!res.ok) {
        const text = await res.text()
        return { ok: false, message: `HTTP ${res.status}: ${text.slice(0, 200)}` }
      }
      return { ok: true, message: `Модель ${cfg.model} відповідає` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeLayout(layout: LayoutConfig): LayoutConfig {
  const ids: LayoutConfig['id'][] = ['face-top', 'face-bottom', 'pip', 'clean-vertical', 'horizontal']
  const id = ids.includes(layout?.id) ? layout.id : 'face-top'
  const cleanRect = (r: LayoutConfig['faceRect']): LayoutConfig['faceRect'] => {
    if (!r) return null
    const x = clampNumber(r.x, 0, 1, 0)
    const y = clampNumber(r.y, 0, 1, 0)
    const w = clampNumber(r.w, 0.03, 1 - x, 0.3)
    const h = clampNumber(r.h, 0.03, 1 - y, 0.3)
    return { x, y, w, h }
  }
  return {
    id,
    faceRect: id === 'clean-vertical' || id === 'horizontal' ? null : cleanRect(layout?.faceRect ?? null),
    gameRect: cleanRect(layout?.gameRect ?? null)
  }
}

function sanitizeSubtitle(subtitle: SubtitleStyle): SubtitleStyle {
  const presets: SubtitleStyle['preset'][] = ['bold', 'boxed', 'karaoke', 'minimal']
  return {
    preset: presets.includes(subtitle?.preset) ? subtitle.preset : 'bold',
    fontFamily: (subtitle?.fontFamily || 'Arial Black').slice(0, 60),
    fontSize: clampNumber(subtitle?.fontSize, 24, 140, 72),
    uppercase: Boolean(subtitle?.uppercase),
    accent: /^#[0-9a-fA-F]{6}$/.test(subtitle?.accent || '') ? subtitle.accent : '#C6FF3D',
    position: ['bottom', 'center', 'top'].includes(subtitle?.position) ? subtitle.position : 'bottom',
    maxWords: clampNumber(subtitle?.maxWords, 2, 8, 4)
  }
}

function uniquePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  let candidate = path.join(dir, fileName)
  let i = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`)
    i++
  }
  return candidate
}

function serveMedia(request: Request): Response {
  const url = new URL(request.url)
  let filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!/^[a-zA-Z]:[\\/]/.test(filePath)) filePath = `/${filePath}`
  if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 })
  const stat = fs.statSync(filePath)
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const range = request.headers.get('range')

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
      if (start >= stat.size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
      }
      const stream = fs.createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
  }

  return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    }
  })
}

function registerIpc(): void {
  ipcMain.handle('app:get-state', (): AppState => {
    return {
      settings: store.getSettings(),
      jobs: store.getJobs()
    }
  })

  ipcMain.handle('settings:save', (_e, settings: Settings) => {
    const saved = store.setSettings(settings)
    ensureDir(saved.outputDir)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:updated', saved)
    }
    return saved
  })

  ipcMain.handle('job:create', (_e, payload: ClipJobPayload, options?: CreateJobOptions) => {
    try {
      return manager.createJob(payload, options)
    } catch (err) {
      userError(err)
    }
  })

  ipcMain.handle('job:retry', async (_e, jobId: string) => {
    await manager.retry(jobId)
  })

  ipcMain.handle('job:cancel', (_e, jobId: string) => {
    manager.cancel(jobId)
  })

  ipcMain.handle('job:delete', (_e, jobId: string) => {
    manager.delete(jobId)
  })

  ipcMain.handle('job:update', (_e, jobId: string, patch: Partial<Job>) => {
    return manager.updateJob(jobId, patch)
  })

  ipcMain.handle('moment:update', (_e, jobId: string, momentId: string, patch: Partial<Moment>) => {
    return manager.updateMoment(jobId, momentId, patch)
  })

  ipcMain.handle('moment:add', (_e, jobId: string, start: number, end: number) => {
    return manager.addMoment(jobId, start, end)
  })

  ipcMain.handle('moment:remove', (_e, jobId: string, momentId: string) => {
    return manager.removeMoment(jobId, momentId)
  })

  ipcMain.handle('moments:select', (_e, jobId: string, ids: string[]) => {
    return manager.selectMoments(jobId, ids)
  })

  ipcMain.handle('job:transcribe', async (_e, jobId: string, srtPath?: string) => {
    const job = store.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    if (manager.isRunning(jobId)) throw new Error('Обробка вже триває')
    const controller = new AbortController()
    const dirs: PipelineDirs = { workDir: path.join(workRoot, jobId), binDir, outputDir: store.getSettings().outputDir }
    job.status = 'transcribing'
    job.progressLabel = 'Транскрипція'
    manager.emit(job)
    try {
      await transcribeJob(job, store.getSettings(), dirs, {
        update: (j) => manager.emit(j),
        log: () => undefined,
        signal: controller.signal
      }, srtPath)
      job.status = 'ready'
      job.progressLabel = job.transcript.length ? `Субтитри: ${job.transcript.length} сегментів` : 'Транскрипція недоступна'
      manager.emit(job)
    } catch (err) {
      job.status = 'ready'
      job.progressLabel = 'Помилка транскрипції'
      job.error = (err as Error).message
      manager.emit(job)
      userError(err)
    }
    return job
  })

  ipcMain.handle('job:analyze', async (_e, jobId: string) => {
    const job = store.getJob(jobId)
    if (!job) throw new Error('Проєкт не знайдено')
    if (manager.isRunning(jobId)) throw new Error('Обробка вже триває')
    const controller = new AbortController()
    const dirs: PipelineDirs = { workDir: path.join(workRoot, jobId), binDir, outputDir: store.getSettings().outputDir }
    job.status = 'analyzing'
    job.progressLabel = 'Пошук моментів'
    manager.emit(job)
    try {
      await runAnalysis(job, store.getSettings(), dirs, {
        update: (j) => manager.emit(j),
        log: (line) => {
          job.logs.push(`[${new Date().toLocaleTimeString('uk-UA', { hour12: false })}] ${line}`)
        },
        signal: controller.signal
      })
      job.status = 'ready'
      manager.emit(job)
    } catch (err) {
      job.status = 'ready'
      job.progressLabel = 'Помилка аналізу'
      job.error = (err as Error).message
      manager.emit(job)
      userError(err)
    }
    return job
  })

  ipcMain.handle('clips:render', async (_e, request: RenderRequest) => {
    return manager.render(request)
  })

  ipcMain.handle('layout:preview', async (_e, request: Parameters<JobManager['preview']>[0]) => {
    return manager.preview(request)
  })

  ipcMain.handle('job:frame', async (_e, jobId: string, time: number) => {
    return manager.frame(jobId, time)
  })

  ipcMain.handle('dialog:pick-file', async (_e, kind: 'video' | 'srt' | 'cookies' | 'executable' | 'model') => {
    const filters: Record<string, Electron.FileFilter[]> = {
      video: [{ name: 'Відео', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'ts', 'flv'] }],
      srt: [{ name: 'Субтитри', extensions: ['srt', 'vtt'] }],
      cookies: [{ name: 'Cookies', extensions: ['txt'] }],
      executable: [{ name: 'Програми', extensions: ['exe'] }],
      model: [{ name: 'Модель Whisper', extensions: ['bin'] }]
    }
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: filters[kind]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:pick-directory', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('shell:open', async (_e, target: string) => {
    if (!target) return
    const err = await shell.openPath(target)
    if (err) throw new Error(err)
  })

  ipcMain.handle('shell:reveal', async (_e, target: string) => {
    if (!target) return
    shell.showItemInFolder(target)
  })

  ipcMain.handle('ai:test', async (_e, settings: Settings) => {
    return manager.testAi(settings)
  })

  ipcMain.handle('ytdlp:ensure', async () => {
    const bin = await ensureYtDlp(store.getSettings().ytdlpPath, binDir, () => undefined)
    return { path: bin, version: ytDlpVersion(bin) }
  })

  ipcMain.handle('app:metrics', () => {
    let clips = 0
    let bytes = 0
    for (const job of store.getJobs()) {
      for (const clip of job.clips) {
        clips++
        try {
          bytes += fs.statSync(clip.filePath).size
        } catch {
          /* ignore */
        }
      }
    }
    return { clips, storageBytes: bytes }
  })

  ipcMain.handle('app:open-output', async () => {
    const dir = store.getSettings().outputDir
    ensureDir(dir)
    await shell.openPath(dir)
  })

  ipcMain.handle('app:open-external', async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('app:platform-labels', () => PLATFORM_LABELS)
}

async function createWindow(): Promise<void> {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico')

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: '#0a0b0d',
    title: 'ClipForge',
    icon: iconPath,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#0a0b0d', symbolColor: '#E7EAF0', height: 44 }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.clipforge.app')
    Menu.setApplicationMenu(null)

    const userData = app.getPath('userData')
    const videos = app.getPath('videos')
    workRoot = path.join(userData, 'work')
    binDir = path.join(userData, 'bin')
    ensureDir(workRoot)
    ensureDir(binDir)

    store = new Store(userData, path.join(videos, 'ClipForge'))
    ensureDir(store.getSettings().outputDir)
    manager = new JobManager(store)

    protocol.handle('clipmedia', serveMedia)
    registerIpc()
    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('before-quit', () => {
    store?.saveNow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
