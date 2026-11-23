import fs from 'node:fs'
import path from 'node:path'
import type { AppState, Job, Settings } from '../shared/types'
import { DEFAULT_SETTINGS, DEFAULT_SUBTITLE } from '../shared/defaults'

function deepMergeSettings(base: Settings, patch: Partial<Settings> | undefined): Settings {
  if (!patch) return structuredClone(base)
  return {
    ...base,
    ...patch,
    ai: { ...base.ai, ...(patch.ai ?? {}) },
    stt: { ...base.stt, ...(patch.stt ?? {}) },
    clipDefaults: {
      ...base.clipDefaults,
      ...(patch.clipDefaults ?? {}),
      subtitle: {
        ...base.clipDefaults.subtitle,
        ...(patch.clipDefaults?.subtitle ?? {})
      }
    }
  }
}

export class Store {
  private filePath: string
  private state: AppState
  private timer: NodeJS.Timeout | null = null

  constructor(userDataDir: string, defaultOutputDir: string) {
    this.filePath = path.join(userDataDir, 'clipforge.json')
    this.state = {
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        outputDir: defaultOutputDir,
        clipDefaults: {
          ...DEFAULT_SETTINGS.clipDefaults,
          subtitle: { ...DEFAULT_SUBTITLE }
        }
      },
      jobs: []
    }
    this.load()
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const data = JSON.parse(raw) as Partial<AppState>
      this.state.settings = deepMergeSettings(structuredClone(DEFAULT_SETTINGS), data.settings)
      if (!this.state.settings.outputDir) {
        this.state.settings.outputDir = path.join(path.dirname(this.filePath), 'clips')
      }
      this.state.jobs = Array.isArray(data.jobs) ? data.jobs : []
      for (const job of this.state.jobs) {
        if (!job.clipOptions) {
          job.clipOptions = {
            count: this.state.settings.clipDefaults.count,
            minDuration: this.state.settings.clipDefaults.minDuration,
            maxDuration: this.state.settings.clipDefaults.maxDuration
          }
        }
        if (!job.layout) {
          job.layout = {
            id: this.state.settings.clipDefaults.layoutId,
            faceRect: { x: 0.7, y: 0.66, w: 0.3, h: 0.32 },
            gameRect: null
          }
        }
        if (!job.subtitle) job.subtitle = { ...DEFAULT_SUBTITLE }
        if (!Array.isArray(job.logs)) job.logs = []
        if (!Array.isArray(job.clips)) job.clips = []
        if (!Array.isArray(job.moments)) job.moments = []
        if (!Array.isArray(job.transcript)) job.transcript = []
        if (['downloading', 'probing', 'transcribing', 'analyzing', 'queued'].includes(job.status)) {
          job.status = 'error'
          job.error = 'Обробку було перервано. Натисніть «Повторити».'
          job.progressLabel = 'Перервано'
        }
      }
    } catch (err) {
      console.error('Не вдалося прочитати сховище:', err)
    }
  }

  getState(): AppState {
    return this.state
  }

  getSettings(): Settings {
    return this.state.settings
  }

  getJobs(): Job[] {
    return this.state.jobs
  }

  getJob(id: string): Job | undefined {
    return this.state.jobs.find((j) => j.id === id)
  }

  addJob(job: Job): void {
    this.state.jobs.unshift(job)
    this.scheduleSave()
  }

  removeJob(id: string): void {
    this.state.jobs = this.state.jobs.filter((j) => j.id !== id)
    this.scheduleSave()
  }

  setSettings(settings: Settings): Settings {
    this.state.settings = deepMergeSettings(structuredClone(DEFAULT_SETTINGS), settings)
    this.scheduleSave()
    return this.state.settings
  }

  scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.saveNow()
    }, 500)
  }

  saveNow(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.state), 'utf8')
      fs.renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('Не вдалося зберегти сховище:', err)
    }
  }
}
