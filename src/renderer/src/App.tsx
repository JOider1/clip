import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, ClipJobPayload, CreateJobOptions, Job, Settings } from '../../shared/types'
import { api } from './api'
import { Sidebar } from './components/Sidebar'
import { Library } from './components/Library'
import { JobView } from './components/JobView'
import { NewJobModal } from './components/NewJobModal'
import { SettingsPage } from './components/SettingsPage'
import { IconAlert, IconCheck, IconLogo, IconSparkles, IconX } from './icons'
import { Spinner } from './components/ui'

type Page = { name: 'library' } | { name: 'job'; id: string } | { name: 'settings' }
type Toast = { id: number; message: string; tone: 'info' | 'success' | 'error' }

export default function App(): React.ReactElement {
  const [state, setState] = useState<AppState | null>(null)
  const [page, setPage] = useState<Page>({ name: 'library' })
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [metrics, setMetrics] = useState({ clips: 0, storageBytes: 0 })
  const [bootError, setBootError] = useState<string | null>(null)
  const toastId = useRef(0)
  const metricsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current
    const clean = message.replace(/^Error invoking remote method '[^']+':\s*/, '')
    setToasts((list) => [...list.slice(-3), { id, message: clean, tone }])
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  useEffect(() => {
    api
      .getState()
      .then(setState)
      .catch((err) => setBootError((err as Error).message))
  }, [])

  // Нова сторінка завжди відкривається згори
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [page])

  useEffect(() => {
    const offJob = api.onJobUpdate((job) => {
      setState((prev) => {
        if (!prev) return prev
        const exists = prev.jobs.some((j) => j.id === job.id)
        return {
          ...prev,
          jobs: exists ? prev.jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...prev.jobs]
        }
      })
    })
    const offRemoved = api.onJobRemoved((jobId) => {
      setState((prev) =>
        prev ? { ...prev, jobs: prev.jobs.filter((j) => j.id !== jobId) } : prev
      )
      setPage((current) =>
        current.name === 'job' && current.id === jobId ? { name: 'library' } : current
      )
    })
    const offToast = api.onToast((message) => notify(message, 'error'))
    return () => {
      offJob()
      offRemoved()
      offToast()
    }
  }, [notify])

  const jobSignature = state?.jobs.map((j) => `${j.clips.length}:${j.status}`).join('|') ?? ''
  useEffect(() => {
    if (!state) return
    if (metricsTimer.current) clearTimeout(metricsTimer.current)
    metricsTimer.current = setTimeout(() => {
      void api.getMetrics().then(setMetrics).catch(() => undefined)
    }, 400)
    return () => {
      if (metricsTimer.current) clearTimeout(metricsTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobSignature, state?.settings.outputDir])

  const settings = state?.settings
  const jobs = state?.jobs ?? []
  const currentJob: Job | undefined =
    page.name === 'job' ? jobs.find((j) => j.id === page.id) : undefined

  const createJob = async (payload: ClipJobPayload, options: CreateJobOptions): Promise<void> => {
    const job = await api.createJob(payload, options)
    setState((prev) => {
      if (!prev) return prev
      return { ...prev, jobs: [job, ...prev.jobs.filter((j) => j.id !== job.id)] }
    })
    setNewJobOpen(false)
    setPage({ name: 'job', id: job.id })
    notify('Проєкт створено — почалася обробка', 'success')
  }

  const saveSettings = async (next: Settings): Promise<void> => {
    const saved = await api.saveSettings(next)
    setState((prev) => (prev ? { ...prev, settings: saved } : prev))
  }

  const deleteJob = async (id: string): Promise<void> => {
    try {
      await api.deleteJob(id)
      setState((prev) => (prev ? { ...prev, jobs: prev.jobs.filter((j) => j.id !== id) } : prev))
      if (page.name === 'job' && page.id === id) setPage({ name: 'library' })
      notify('Проєкт видалено')
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  const retryJob = (id: string): void => {
    void api.retryJob(id).catch((err) => notify((err as Error).message, 'error'))
  }

  const openOutput = (): void => {
    if (!settings) return
    void api.openPath(settings.outputDir).catch((err) => notify((err as Error).message, 'error'))
  }

  if (bootError) {
    return (
      <div className="boot boot-error">
        <IconAlert size={28} />
        <h1>Не вдалося запустити ClipForge</h1>
        <p>{bootError}</p>
      </div>
    )
  }

  if (!state || !settings) {
    return (
      <div className="boot">
        <div className="boot-logo">
          <IconLogo size={34} />
        </div>
        <h1>ClipForge</h1>
        <p>Готую студію…</p>
        <Spinner size={20} />
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-mark">
            <IconLogo size={18} />
          </span>
          <span className="brand-name">ClipForge</span>
          <span className="brand-tag">studio</span>
        </div>
        <div className="titlebar-note">
          <IconSparkles size={13} />
          Локальна студія · файли на твоєму ПК
        </div>
      </div>

      <Sidebar
        page={page.name}
        settings={settings}
        clips={metrics.clips}
        storageBytes={metrics.storageBytes}
        onNavigate={(target) =>
          setPage(target === 'library' ? { name: 'library' } : { name: 'settings' })
        }
        onNew={() => setNewJobOpen(true)}
        onOpenOutput={openOutput}
      />

      <main
        className="app-main"
        ref={mainRef}
        key={page.name === 'job' ? page.id : page.name}
      >
        {page.name === 'library' ? (
          <Library
            jobs={jobs}
            clips={metrics.clips}
            storageBytes={metrics.storageBytes}
            aiReady={settings.ai.enabled && Boolean(settings.ai.apiKey)}
            onOpen={(id) => setPage({ name: 'job', id })}
            onNew={() => setNewJobOpen(true)}
            onRetry={retryJob}
            onDelete={(id) => void deleteJob(id)}
            onOpenOutput={openOutput}
          />
        ) : null}

        {page.name === 'job' && currentJob ? (
          <JobView
            job={currentJob}
            onBack={() => setPage({ name: 'library' })}
            onToast={notify}
            onOpenSettings={() => setPage({ name: 'settings' })}
            onDeleted={() => void deleteJob(currentJob.id)}
            onOpenOutput={openOutput}
          />
        ) : null}

        {page.name === 'job' && !currentJob ? (
          <div className="page">
            <div className="empty">
              <h3>Проєкт не знайдено</h3>
              <button className="btn btn-primary" onClick={() => setPage({ name: 'library' })}>
                До бібліотеки
              </button>
            </div>
          </div>
        ) : null}

        {page.name === 'settings' ? (
          <SettingsPage
            settings={settings}
            metrics={metrics}
            onSave={saveSettings}
            onToast={notify}
            onOpenOutput={openOutput}
          />
        ) : null}
      </main>

      {newJobOpen ? (
        <NewJobModal
          settings={settings}
          onClose={() => setNewJobOpen(false)}
          onCreate={createJob}
          onOpenSettings={() => {
            setNewJobOpen(false)
            setPage({ name: 'settings' })
          }}
        />
      ) : null}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span className="toast-icon">
              {toast.tone === 'error' ? (
                <IconAlert size={15} />
              ) : toast.tone === 'success' ? (
                <IconCheck size={15} />
              ) : (
                <IconSparkles size={15} />
              )}
            </span>
            <span>{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => setToasts((list) => list.filter((t) => t.id !== toast.id))}
            >
              <IconX size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
