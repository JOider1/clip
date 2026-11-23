import fs from 'node:fs'
import path from 'node:path'
import type { Job, Settings, TranscriptSegment } from '../../shared/types'
import { STEP_TEMPLATE } from '../../shared/defaults'
import { extractAudio, extractFrame, fileExists, probe, safeName } from './media'
import { detectSourceType, downloadVideo, ensureYtDlp, fetchMeta } from './ytdlp'
import { computeEnergy, analyze, type EnergyPoint } from './analyze'
import { parseSubtitleFile, transcribe } from './transcribe'
export interface PipelineDirs {
  workDir: string
  binDir: string
  outputDir: string
}

export interface PipelineHooks {
  update: (job: Job) => void
  log: (line: string) => void
  signal: AbortSignal
}

function pushLog(job: Job, line: string): void {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
  if (!clean) return
  const ts = new Date().toLocaleTimeString('uk-UA', { hour12: false })
  job.logs.push(`[${ts}] ${clean}`)
  if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300)
}

export function initSteps(job: Job): void {
  if (job.steps.length) return
  job.steps = STEP_TEMPLATE.map((s) => ({ key: s.key, label: s.label, status: 'pending' }))
}

function step(job: Job, key: string, status: 'pending' | 'active' | 'done' | 'error' | 'skipped', detail?: string): void {
  const s = job.steps.find((x) => x.key === key)
  if (!s) return
  s.status = status
  if (detail !== undefined) s.detail = detail
}

function setProgress(job: Job, progress: number, label: string): void {
  job.progress = Math.max(0, Math.min(100, Math.round(progress)))
  job.progressLabel = label
}

export async function ensureAudio(
  job: Job,
  workDir: string,
  hooks: PipelineHooks,
  audioProgress?: (pct: number) => void
): Promise<string> {
  const target = path.join(workDir, 'audio.wav')
  if (fileExists(target)) {
    job.audioPath = target
    audioProgress?.(100)
    return target
  }
  if (!job.videoPath || !fileExists(job.videoPath)) throw new Error('Відеофайл не знайдено')
  hooks.log('Виділяю аудіодоріжку…')
  await extractAudio(job.videoPath, target, {
    signal: hooks.signal,
    onStderr: (line) => {
      if (/error/i.test(line)) hooks.log(line)
    }
  })
  job.audioPath = target
  audioProgress?.(100)
  return target
}

export async function readEnergy(workDir: string): Promise<EnergyPoint[] | null> {
  const file = path.join(workDir, 'energy.json')
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as EnergyPoint[]
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

async function ensureEnergy(
  audioPath: string,
  workDir: string,
  hooks: PipelineHooks,
  onProgress?: (pct: number) => void
): Promise<EnergyPoint[]> {
  const cached = await readEnergy(workDir)
  if (cached) {
    onProgress?.(100)
    return cached
  }
  hooks.log('Шукаю емоційні сплески у звуці…')
  const energy = await computeEnergy(audioPath, workDir, hooks.log, hooks.signal)
  fs.writeFileSync(path.join(workDir, 'energy.json'), JSON.stringify(energy), 'utf8')
  onProgress?.(100)
  return energy
}

export async function runAnalysis(
  job: Job,
  settings: Settings,
  dirs: PipelineDirs,
  hooks: PipelineHooks
): Promise<void> {
  initSteps(job)
  const energy =
    (await readEnergy(dirs.workDir)) ??
    (job.audioPath && fileExists(job.audioPath)
      ? await ensureEnergy(job.audioPath, dirs.workDir, hooks, (p) =>
          setProgress(job, 10 + p * 0.15, 'Аналіз звуку')
        )
      : [])

  setProgress(job, 20, 'Пошук найкращих моментів')
  step(job, 'analyze', 'active')
  const result = await analyze({
    title: job.title,
    duration: job.duration,
    platform: job.sourceType,
    transcript: job.transcript,
    energy,
    settings,
    count: job.clipOptions.count,
    minDuration: job.clipOptions.minDuration,
    maxDuration: job.clipOptions.maxDuration,
    log: hooks.log,
    onProgress: (pct) => setProgress(job, 20 + pct * 0.7, 'Оцінка вірусності'),
    signal: hooks.signal
  })

  job.moments = result.moments
  job.aiUsed = result.usedAi
  if (result.note) hooks.log(result.note)
  step(job, 'analyze', 'done', `${result.moments.length} моментів${result.usedAi ? ' · AI' : ' · евристика'}`)
  setProgress(job, 100, 'Готово')
}

async function transcribeStage(
  job: Job,
  settings: Settings,
  dirs: PipelineDirs,
  hooks: PipelineHooks
): Promise<void> {
  if (job.transcript.length) {
    step(job, 'transcribe', 'skipped', `Вже є ${job.transcript.length} сегментів`)
    return
  }
  const audioPath = await ensureAudio(job, dirs.workDir, hooks)
  if (!audioPath) {
    step(job, 'transcribe', 'skipped', 'Немає звуку')
    return
  }
  step(job, 'transcribe', 'active')
  job.status = 'transcribing'
  setProgress(job, 40, 'Транскрипція')
  hooks.update(job)
  try {
    const result = await transcribe(
      settings.stt,
      audioPath,
      job.duration,
      dirs.workDir,
      hooks.log,
      (pct) => setProgress(job, 40 + pct * 0.22, 'Транскрипція'),
      hooks.signal
    )
    job.transcript = result.segments
    if (result.note) hooks.log(result.note)
    step(
      job,
      'transcribe',
      result.segments.length ? 'done' : 'skipped',
      result.segments.length ? `${result.segments.length} сегментів` : result.note || 'Без транскрипту'
    )
  } catch (err) {
    // транскрипція не критична: кліпи можна робити й без субтитрів
    hooks.log(`Транскрипція не вдалася: ${(err as Error).message}`)
    step(job, 'transcribe', 'error', (err as Error).message.slice(0, 120))
    if (hooks.signal.aborted) throw err
  }
  hooks.update(job)
}

export async function runPipeline(
  job: Job,
  settings: Settings,
  dirs: PipelineDirs,
  hooks: PipelineHooks
): Promise<void> {
  initSteps(job)
  fs.mkdirSync(dirs.workDir, { recursive: true })
  const log = (line: string): void => {
    hooks.log(line)
    pushLog(job, line)
  }

  try {
    /* 1. Джерело */
    if (job.sourceUrl) {
      step(job, 'download', 'active')
      job.status = 'downloading'
      setProgress(job, 2, 'Підготовка yt-dlp')
      hooks.update(job)

      const bin = await ensureYtDlp(settings.ytdlpPath, dirs.binDir, log)
      const existing = fs
        .readdirSync(dirs.workDir)
        .filter((f) => f.startsWith('source.') && !f.endsWith('.part'))
        .map((f) => path.join(dirs.workDir, f))
      if (existing.length) {
        job.videoPath = existing[0]
        log('Використовую вже завантажене відео')
      } else {
        log(`Джерело: ${job.sourceUrl}`)
        const meta = await fetchMeta(bin, job.sourceUrl, settings.cookiesFile, log)
        if (meta?.title) {
          job.title = meta.title
          if (!job.duration && meta.duration) job.duration = meta.duration
        }
        hooks.update(job)

        if (job.sourceType === 'other') job.sourceType = detectSourceType(job.sourceUrl)

        setProgress(job, 4, 'Завантаження відео')
        const videoPath = await downloadVideo(
          bin,
          job.sourceUrl,
          dirs.workDir,
          settings.cookiesFile,
          log,
          (pct) => {
            setProgress(job, 4 + pct * 0.24, `Завантаження ${pct.toFixed(0)}%`)
            hooks.update(job)
          },
          hooks.signal
        )
        job.videoPath = videoPath
      }
      step(job, 'download', 'done')
    } else if (job.filePath) {
      if (!fileExists(job.filePath)) throw new Error('Відеофайл не знайдено — можливо, його переміщено')
      job.videoPath = job.filePath
      job.title = job.title || path.basename(job.filePath, path.extname(job.filePath))
      step(job, 'download', 'skipped', 'Локальний файл')
    } else {
      throw new Error('Не вказано джерело відео')
    }

    if (hooks.signal.aborted) throw new Error('Скасовано')
    setProgress(job, 29, 'Читаю параметри відео')
    job.status = 'probing'
    step(job, 'probe', 'active')
    hooks.update(job)

    /* 2. Проба */
    const info = await probe(job.videoPath!)
    job.duration = info.duration || job.duration
    job.width = info.width
    job.height = info.height
    job.fps = info.fps
    if (!job.duration) throw new Error('Не вдалося визначити тривалість відео')
    log(`Відео: ${info.width}×${info.height}, ${Math.round(info.duration)} с, ${info.fps.toFixed(1)} fps`)

    // коригуємо шаблон під орієнтацію джерела
    const aspect = info.width / Math.max(1, info.height)
    if (job.layout.id === 'horizontal') {
      job.layout.faceRect = null
    } else if (aspect < 1.1) {
      job.layout.faceRect = null
    }

    const thumbPath = path.join(dirs.workDir, 'source.jpg')
    if (!fileExists(thumbPath)) {
      await extractFrame(job.videoPath!, Math.min(5, job.duration * 0.08), thumbPath, {
        signal: hooks.signal
      }).catch(() => undefined)
    }
    if (fileExists(thumbPath)) job.thumbnailPath = thumbPath

    step(job, 'probe', 'done', `${info.width}×${info.height} · ${Math.round(info.duration)} с`)
    setProgress(job, 34, 'Виділення звуку')
    hooks.update(job)

    /* 3. Звук */
    step(job, 'audio', 'active')
    const audioPath = await ensureAudio(job, dirs.workDir, { ...hooks, log }, (pct) =>
      setProgress(job, 34 + pct * 0.04, 'Виділення звуку')
    )
    step(job, 'audio', 'done')
    hooks.update(job)
    if (hooks.signal.aborted) throw new Error('Скасовано')

    /* 4. Транскрипція */
    await transcribeStage(job, settings, dirs, { ...hooks, log })
    if (hooks.signal.aborted) throw new Error('Скасовано')

    /* 5. Аналіз */
    job.status = 'analyzing'
    setProgress(job, 64, 'Аналіз емоцій')
    step(job, 'analyze', 'active')
    hooks.update(job)

    const energy = await ensureEnergy(audioPath, dirs.workDir, { ...hooks, log }, (pct) =>
      setProgress(job, 64 + pct * 0.06, 'Аналіз звуку')
    )

    const result = await analyze({
      title: job.title,
      duration: job.duration,
      platform: job.sourceType,
      transcript: job.transcript,
      energy,
      settings,
      count: job.clipOptions.count,
      minDuration: job.clipOptions.minDuration,
      maxDuration: job.clipOptions.maxDuration,
      log: (line) => {
        log(line)
        hooks.update(job)
      },
      onProgress: (pct) => {
        setProgress(job, 70 + pct * 0.28, 'Оцінка вірусності')
        hooks.update(job)
      },
      signal: hooks.signal
    })

    job.moments = result.moments
    job.aiUsed = result.usedAi
    if (result.note) log(result.note)
    step(job, 'analyze', 'done', `${result.moments.length} моментів${result.usedAi ? ' · AI' : ' · евристика'}`)

    job.status = 'ready'
    job.error = undefined
    setProgress(job, 100, 'Моменти готові')
    step(job, 'ready', 'done')
    log(`Знайдено ${job.moments.length} моментів. Обери найкращі та натисни «Створити кліпи».`)
    hooks.update(job)
  } catch (err) {
    if (hooks.signal.aborted) {
      job.status = 'canceled'
      job.progressLabel = 'Скасовано'
      hooks.update(job)
      return
    }
    throw err
  }
}

/** Окремий запуск транскрипції для готового проєкту (або імпорт SRT). */
export async function transcribeJob(
  job: Job,
  settings: Settings,
  dirs: PipelineDirs,
  hooks: PipelineHooks,
  srtPath?: string
): Promise<void> {
  const log = (line: string): void => {
    hooks.log(line)
    pushLog(job, line)
  }
  try {
    if (srtPath) {
      const segments: TranscriptSegment[] = parseSubtitleFile(srtPath)
      if (!segments.length) throw new Error('У файлі не знайдено субтитрів')
      job.transcript = segments
      log(`Імпортовано ${segments.length} сегментів субтитрів`)
      step(job, 'transcribe', 'done', `Імпорт: ${segments.length}`)
      hooks.update(job)
      return
    }

    if (!job.videoPath) throw new Error('Немає відео')
    if (!job.duration) {
      const info = await probe(job.videoPath)
      job.duration = info.duration
      job.width = info.width
      job.height = info.height
      job.fps = info.fps
    }
    await transcribeStage(job, settings, dirs, { ...hooks, log })
    step(job, 'transcribe', job.transcript.length ? 'done' : 'skipped')
    hooks.update(job)
  } catch (err) {
    if (!hooks.signal.aborted) {
      job.error = (err as Error).message
      hooks.update(job)
      throw err
    }
  }
}

export function clipFileName(job: Job, index: number, title: string): string {
  const stamp = new Date().toISOString().slice(0, 10)
  return `${String(index + 1).padStart(2, '0')} ${safeName(title || job.title)} ${stamp}.mp4`
}
