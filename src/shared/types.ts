/* ─────────────────────────────────────────────────────────────
   Спільні типи між main / preload / renderer
   ───────────────────────────────────────────────────────────── */

export type SourceType = 'youtube' | 'twitch' | 'file' | 'other'

export interface Rect {
  /** 0..1 — частка ширини кадру */
  x: number
  y: number
  w: number
  h: number
}

export type LayoutId = 'face-top' | 'face-bottom' | 'pip' | 'clean-vertical' | 'horizontal'

export interface LayoutConfig {
  id: LayoutId
  /** Зона обличчя / вебки у вихідному кадрі. null = немає вебки */
  faceRect: Rect | null
  /** Зона геймплею. null = весь кадр */
  gameRect: Rect | null
}

export type SubtitlePreset = 'bold' | 'boxed' | 'karaoke' | 'minimal'

export interface SubtitleStyle {
  preset: SubtitlePreset
  fontFamily: string
  fontSize: number
  uppercase: boolean
  accent: string
  position: 'bottom' | 'center' | 'top'
  maxWords: number
}

export interface AiSettings {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

export type SttMode = 'api' | 'local' | 'off'

export interface SttSettings {
  mode: SttMode
  baseUrl: string
  apiKey: string
  model: string
  /** порожньо = авто */
  language: string
  binaryPath: string
  modelPath: string
}

export interface ClipDefaults {
  minDuration: number
  maxDuration: number
  count: number
  layoutId: LayoutId
  burnSubtitles: boolean
  subtitle: SubtitleStyle
}

export interface Settings {
  ai: AiSettings
  stt: SttSettings
  ytdlpPath: string
  cookiesFile: string
  outputDir: string
  clipDefaults: ClipDefaults
  onboardingDone: boolean
}

export interface TranscriptWord {
  start: number
  end: number
  text: string
}

export interface TranscriptSegment {
  id: number
  start: number
  end: number
  text: string
  words?: TranscriptWord[]
}

export type MomentSource = 'ai' | 'heuristic' | 'manual'

export interface Moment {
  id: string
  start: number
  end: number
  /** 0..100 */
  score: number
  title: string
  hook: string
  reason: string
  tags: string[]
  source: MomentSource
  selected: boolean
}

export interface Clip {
  id: string
  momentId: string
  filePath: string
  thumbPath?: string
  layoutId: LayoutId
  width: number
  height: number
  duration: number
  title: string
  createdAt: number
}

export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'probing'
  | 'transcribing'
  | 'analyzing'
  | 'rendering'
  | 'ready'
  | 'error'
  | 'canceled'

export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'

export interface JobStep {
  key: string
  label: string
  status: StepStatus
  detail?: string
}

export interface MediaInfo {
  duration: number
  width: number
  height: number
  fps: number
}

export interface Job {
  id: string
  title: string
  sourceType: SourceType
  sourceUrl?: string
  filePath?: string
  videoPath?: string
  audioPath?: string
  thumbnailPath?: string
  duration: number
  width: number
  height: number
  fps: number
  createdAt: number
  status: JobStatus
  progress: number
  progressLabel: string
  error?: string
  steps: JobStep[]
  clipOptions: {
    count: number
    minDuration: number
    maxDuration: number
  }
  transcript: TranscriptSegment[]
  moments: Moment[]
  clips: Clip[]
  layout: LayoutConfig
  subtitle: SubtitleStyle
  logs: string[]
  aiUsed: boolean
}

export interface AppState {
  settings: Settings
  jobs: Job[]
}

export type ClipJobPayload =
  | { kind: 'url'; url: string }
  | { kind: 'file'; filePath: string }

export interface CreateJobOptions {
  count?: number
  minDuration?: number
  maxDuration?: number
  layoutId?: LayoutId
  subtitle?: SubtitleStyle
}

export interface RenderRequest {
  jobId: string
  momentIds: string[]
  layout: LayoutConfig
  subtitle: SubtitleStyle
  burnSubtitles: boolean
}

export interface LayoutPreviewRequest {
  jobId: string
  layout: LayoutConfig
  subtitle: SubtitleStyle
  burnSubtitles: boolean
  time: number
}

export interface AiTestResult {
  ok: boolean
  message: string
}

export interface DownloadProgress {
  jobId: string
  percent: number
  label: string
}

/* ── IPC контракт ─────────────────────────────────────────── */

export interface ClipperApi {
  getState(): Promise<AppState>
  saveSettings(settings: Settings): Promise<Settings>
  createJob(payload: ClipJobPayload, options?: CreateJobOptions): Promise<Job>
  deleteJob(jobId: string): Promise<void>
  retryJob(jobId: string): Promise<void>
  cancelJob(jobId: string): Promise<void>
  updateJob(jobId: string, patch: Partial<Job>): Promise<Job>
  updateMoment(jobId: string, momentId: string, patch: Partial<Moment>): Promise<Job>
  addMoment(jobId: string, start: number, end: number): Promise<Job>
  removeMoment(jobId: string, momentId: string): Promise<Job>
  selectMoments(jobId: string, ids: string[]): Promise<Job>
  transcribeJob(jobId: string, srtPath?: string): Promise<Job>
  runAnalysis(jobId: string): Promise<Job>
  renderClips(request: RenderRequest): Promise<Clip[]>
  previewLayout(request: LayoutPreviewRequest): Promise<string>
  extractFrame(jobId: string, time: number): Promise<string>
  pickFile(kind: 'video' | 'srt' | 'cookies' | 'executable' | 'model'): Promise<string | null>
  pickDirectory(): Promise<string | null>
  openPath(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  testAi(settings: Settings): Promise<AiTestResult>
  ensureYtdlp(): Promise<{ path: string; version: string }>
  getMetrics(): Promise<{ clips: number; storageBytes: number }>
  onJobUpdate(cb: (job: Job) => void): () => void
  onJobRemoved(cb: (jobId: string) => void): () => void
  onToast(cb: (message: string) => void): () => void
  mediaUrl(path: string): string
}
