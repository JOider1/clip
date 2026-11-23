import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiTestResult,
  AppState,
  Clip,
  ClipJobPayload,
  ClipperApi,
  CreateJobOptions,
  Job,
  LayoutPreviewRequest,
  Moment,
  RenderRequest,
  Settings
} from '../shared/types'

const api: ClipperApi = {
  getState: () => ipcRenderer.invoke('app:get-state') as Promise<AppState>,
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke('settings:save', settings) as Promise<Settings>,
  createJob: (payload: ClipJobPayload, options?: CreateJobOptions) =>
    ipcRenderer.invoke('job:create', payload, options) as Promise<Job>,
  deleteJob: (jobId: string) => ipcRenderer.invoke('job:delete', jobId) as Promise<void>,
  retryJob: (jobId: string) => ipcRenderer.invoke('job:retry', jobId) as Promise<void>,
  cancelJob: (jobId: string) => ipcRenderer.invoke('job:cancel', jobId) as Promise<void>,
  updateJob: (jobId: string, patch: Partial<Job>) =>
    ipcRenderer.invoke('job:update', jobId, patch) as Promise<Job>,
  updateMoment: (jobId: string, momentId: string, patch: Partial<Moment>) =>
    ipcRenderer.invoke('moment:update', jobId, momentId, patch) as Promise<Job>,
  addMoment: (jobId: string, start: number, end: number) =>
    ipcRenderer.invoke('moment:add', jobId, start, end) as Promise<Job>,
  removeMoment: (jobId: string, momentId: string) =>
    ipcRenderer.invoke('moment:remove', jobId, momentId) as Promise<Job>,
  selectMoments: (jobId: string, ids: string[]) =>
    ipcRenderer.invoke('moments:select', jobId, ids) as Promise<Job>,
  transcribeJob: (jobId: string, srtPath?: string) =>
    ipcRenderer.invoke('job:transcribe', jobId, srtPath) as Promise<Job>,
  runAnalysis: (jobId: string) => ipcRenderer.invoke('job:analyze', jobId) as Promise<Job>,
  renderClips: (request: RenderRequest) =>
    ipcRenderer.invoke('clips:render', request) as Promise<Clip[]>,
  previewLayout: (request: LayoutPreviewRequest) =>
    ipcRenderer.invoke('layout:preview', request) as Promise<string>,
  extractFrame: (jobId: string, time: number) =>
    ipcRenderer.invoke('job:frame', jobId, time) as Promise<string>,
  pickFile: (kind: 'video' | 'srt' | 'cookies' | 'executable' | 'model') =>
    ipcRenderer.invoke('dialog:pick-file', kind) as Promise<string | null>,
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory') as Promise<string | null>,
  openPath: (path: string) => ipcRenderer.invoke('shell:open', path) as Promise<void>,
  showInFolder: (path: string) => ipcRenderer.invoke('shell:reveal', path) as Promise<void>,
  openExternal: (url: string) =>
    ipcRenderer.invoke('app:open-external', url) as Promise<void>,
  testAi: (settings: Settings) => ipcRenderer.invoke('ai:test', settings) as Promise<AiTestResult>,
  ensureYtdlp: () =>
    ipcRenderer.invoke('ytdlp:ensure') as Promise<{ path: string; version: string }>,
  getMetrics: () =>
    ipcRenderer.invoke('app:metrics') as Promise<{ clips: number; storageBytes: number }>,
  onJobUpdate: (cb: (job: Job) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, job: Job): void => cb(job)
    ipcRenderer.on('job:update', handler)
    return () => ipcRenderer.removeListener('job:update', handler)
  },
  onJobRemoved: (cb: (jobId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, jobId: string): void => cb(jobId)
    ipcRenderer.on('job:removed', handler)
    return () => ipcRenderer.removeListener('job:removed', handler)
  },
  onToast: (cb: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => cb(message)
    ipcRenderer.on('app:toast', handler)
    return () => ipcRenderer.removeListener('app:toast', handler)
  },
  mediaUrl: (filePath: string) => `clipmedia://local/${encodeURIComponent(filePath)}`
}

contextBridge.exposeInMainWorld('clipper', api)
