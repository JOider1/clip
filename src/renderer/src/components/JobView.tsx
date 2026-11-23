import { useEffect, useRef, useState } from 'react'
import type { Job, TranscriptSegment } from '../../../shared/types'
import { api } from '../api'
import {
  IconAlert,
  IconBack,
  IconCaptions,
  IconCheck,
  IconClock,
  IconFilm,
  IconFolder,
  IconLayout,
  IconPlay,
  IconRefresh,
  IconScissors,
  IconSparkles,
  IconStop,
  IconTrash,
  IconWand
} from '../icons'
import {
  LAYOUT_LABEL,
  SOURCE_LABEL,
  STATUS,
  fmtDate,
  fmtDuration,
  isBusy
} from '../utils'
import { Badge, ProgressBar, Spinner } from './ui'
import { MomentsTab } from './MomentsTab'
import { LayoutTab } from './LayoutTab'
import { ClipsTab } from './ClipsTab'
import { TranscriptTab } from './TranscriptTab'
import { SourceTab } from './SourceTab'
import { PlayerModal } from './PlayerModal'

type Tab = 'moments' | 'layout' | 'clips' | 'transcript' | 'source'

export function JobView({
  job,
  onBack,
  onToast,
  onOpenSettings,
  onDeleted,
  onOpenOutput
}: {
  job: Job
  onBack: () => void
  onToast: (message: string) => void
  onOpenSettings: () => void
  onDeleted: () => void
  onOpenOutput: () => void
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>(job.status === 'ready' && job.clips.length ? 'clips' : 'moments')
  const [layout, setLayout] = useState(job.layout)
  const [subtitle, setSubtitle] = useState(job.subtitle)
  const [burnSubtitles, setBurnSubtitles] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [player, setPlayer] = useState<{ title: string; start: number; end: number } | null>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(job.title)
  const firstRender = useRef(true)
  const selected = job.moments.filter((m) => m.selected)
  const busy = isBusy(job)
  const status = STATUS[job.status]

  useEffect(() => {
    setLayout(job.layout)
    setSubtitle(job.subtitle)
    setTitleDraft(job.title)
    firstRender.current = true
    setTab(job.status === 'ready' && job.clips.length ? 'clips' : 'moments')
  }, [job.id])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const timer = setTimeout(() => {
      void api.updateJob(job.id, { layout, subtitle }).catch(() => undefined)
    }, 500)
    return () => clearTimeout(timer)
  }, [layout, subtitle, job.id])

  const createClips = async (): Promise<void> => {
    if (!selected.length) {
      onToast('Обери хоча б один момент')
      return
    }
    setRendering(true)
    try {
      await api.updateJob(job.id, { layout, subtitle })
      const clips = await api.renderClips({
        jobId: job.id,
        momentIds: selected.map((m) => m.id),
        layout,
        subtitle,
        burnSubtitles
      })
      onToast(`Готово: ${clips.length} кліпів у папці`)
      setTab('clips')
    } catch (err) {
      onToast((err as Error).message.replace(/^Error invoking remote method '[^']+':\s*/, ''))
    } finally {
      setRendering(false)
    }
  }

  const analyze = async (): Promise<void> => {
    try {
      await api.runAnalysis(job.id)
      onToast('Моменти оновлено')
      setTab('moments')
    } catch (err) {
      onToast((err as Error).message)
    }
  }

  const remove = (): void => {
    if (window.confirm(`Видалити проєкт «${job.title}»?`)) {
      onDeleted()
    }
  }

  const saveTitle = async (): Promise<void> => {
    const title = titleDraft.trim()
    if (title && title !== job.title) {
      await api.updateJob(job.id, { title }).catch((err) => onToast((err as Error).message))
    }
    setTitleEditing(false)
  }

  const openSegment = (segment: TranscriptSegment): void => {
    setPlayer({
      title: 'Фрагмент транскрипту',
      start: Math.max(0, segment.start - 0.3),
      end: segment.end + 1.2
    })
  }

  return (
    <div className="page job-page">
      <div className="job-nav">
        <button className="back-btn" onClick={onBack}>
          <IconBack size={17} />
          Бібліотека
        </button>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">{job.title}</span>
      </div>

      <header className="job-header">
        <div className="job-title-block">
          <div className="job-badges">
            <span className={`platform platform-${job.sourceType}`}>{SOURCE_LABEL[job.sourceType]}</span>
            <span className={`status status-${status.tone}`}>
              {busy ? <span className="pulse-dot" /> : null}
              {status.label}
            </span>
            {job.aiUsed ? (
              <span className="soft-chip">
                <IconSparkles size={12} /> AI
              </span>
            ) : null}
            <span className="soft-chip">{LAYOUT_LABEL[layout.id]}</span>
          </div>

          {titleEditing ? (
            <input
              className="title-input"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTitle()
                if (e.key === 'Escape') {
                  setTitleDraft(job.title)
                  setTitleEditing(false)
                }
              }}
            />
          ) : (
            <h1 onClick={() => setTitleEditing(true)} title="Натисни, щоб перейменувати">
              {job.title}
            </h1>
          )}

          <div className="job-meta-line">
            {job.duration ? (
              <span>
                <IconClock size={13} /> {fmtDuration(job.duration)}
              </span>
            ) : null}
            {job.width ? (
              <span>
                <IconFilm size={13} /> {job.width}×{job.height}
              </span>
            ) : null}
            <span>{fmtDate(job.createdAt)}</span>
            {job.sourceUrl ? <span className="ellipsis">{job.sourceUrl}</span> : null}
            {job.filePath ? <span className="ellipsis">{job.filePath}</span> : null}
          </div>
        </div>

        <div className="job-header-actions">
          {busy ? (
            <button className="btn btn-ghost" onClick={() => void api.cancelJob(job.id)}>
              <IconStop size={15} />
              Зупинити
            </button>
          ) : null}
          {job.status === 'error' || job.status === 'canceled' ? (
            <button className="btn btn-ghost" onClick={() => void api.retryJob(job.id)}>
              <IconRefresh size={15} />
              Повторити
            </button>
          ) : null}
          {job.clips.length ? (
            <button className="btn btn-ghost" onClick={() => void api.showInFolder(job.clips[0].filePath)}>
              <IconFolder size={15} />
              Кліпи
            </button>
          ) : null}
          <button className="icon-btn danger" onClick={remove} title="Видалити проєкт">
            <IconTrash size={16} />
          </button>
        </div>
      </header>

      {busy || job.status === 'error' || job.status === 'canceled' ? (
        <section className={`pipeline-card ${job.status === 'error' ? 'has-error' : ''}`}>
          <div className="pipeline-top">
            <div className="pipeline-label">
              {job.status === 'error' ? <IconAlert size={16} /> : <Spinner size={15} />}
              <strong>{job.progressLabel}</strong>
              <span className="muted small">{job.progress}%</span>
            </div>
            <span className="muted small">Етапи обробки</span>
          </div>
          <ProgressBar value={job.progress} tone={job.status === 'error' ? 'red' : 'green'} />
          <div className="steps">
            {job.steps.map((step) => (
              <div key={step.key} className={`step step-${step.status}`} title={step.detail}>
                <span className="step-dot">
                  {step.status === 'done' ? (
                    <IconCheck size={12} />
                  ) : step.status === 'active' ? (
                    <span className="pulse-dot" />
                  ) : step.status === 'error' ? (
                    '!'
                  ) : (
                    ''
                  )}
                </span>
                <span className="step-name">{step.label}</span>
                {step.detail ? <span className="step-detail">{step.detail}</span> : null}
              </div>
            ))}
          </div>
          {job.error ? <div className="inline-error">{job.error}</div> : null}
        </section>
      ) : null}

      <div className="job-toolbar">
        <div className="tabs">
          {(
            [
              ['moments', `Моменти`, job.moments.length],
              ['layout', 'Шаблон', null],
              ['clips', 'Кліпи', job.clips.length],
              ['transcript', 'Транскрипт', job.transcript.length],
              ['source', 'Джерело', null]
            ] as [Tab, string, number | null][]
          ).map(([id, label, count]) => (
            <button
              key={id}
              className={`tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
              {count ? <span className="tab-count">{count}</span> : null}
            </button>
          ))}
        </div>

        <div className="toolbar-actions">
          {selected.length ? <span className="selected-count">Обрано {selected.length}</span> : null}
          {job.moments.length ? (
            <button className="btn btn-ghost btn-sm" onClick={() => void analyze()} disabled={busy || rendering}>
              <IconWand size={14} />
              Переаналізувати
            </button>
          ) : null}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void createClips()}
            disabled={busy || rendering || !selected.length}
          >
            {rendering || job.status === 'rendering' ? <Spinner size={14} /> : <IconScissors size={15} />}
            {rendering || job.status === 'rendering'
              ? 'Рендер…'
              : `Створити кліпи${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        </div>
      </div>

      <div className="tab-body">
        {tab === 'moments' ? (
          <MomentsTab
            job={job}
            onPlay={(moment) => setPlayer({ title: moment.title, start: moment.start, end: moment.end })}
            onToast={onToast}
            onAnalyze={() => void analyze()}
          />
        ) : null}
        {tab === 'layout' ? (
          <LayoutTab
            job={job}
            layout={layout}
            subtitle={subtitle}
            burnSubtitles={burnSubtitles}
            setLayout={setLayout}
            setSubtitle={setSubtitle}
            setBurnSubtitles={setBurnSubtitles}
            onToast={onToast}
          />
        ) : null}
        {tab === 'clips' ? (
          <ClipsTab
            job={job}
            selectedCount={selected.length}
            onCreate={() => void createClips()}
            onOpenOutput={onOpenOutput}
            onToast={onToast}
          />
        ) : null}
        {tab === 'transcript' ? (
          <TranscriptTab
            job={job}
            onToast={onToast}
            onAnalyze={() => void analyze()}
            onPlaySegment={openSegment}
          />
        ) : null}
        {tab === 'source' ? (
          <SourceTab
            job={job}
            onToast={onToast}
            onAdded={() => setTab('moments')}
          />
        ) : null}
      </div>

      {job.status === 'ready' && job.moments.length === 0 ? (
        <div className="unconfigured-banner">
          <IconCaptions size={16} />
          <span>Немає моментів. Переаналізуй або додай вручну.</span>
          <button className="link-btn" onClick={onOpenSettings}>
            Налаштування AI
          </button>
        </div>
      ) : null}

      {player ? (
        <PlayerModal
          title={player.title}
          src={api.mediaUrl(job.videoPath ?? '')}
          start={player.start}
          end={player.end}
          onClose={() => setPlayer(null)}
        />
      ) : null}

      <div className="job-footer-hint">
        <IconLayout size={13} />
        Фінальне відео: 1080×1920 H.264 + AAC · субтитри впалені · гучність −14 LUFS
      </div>
    </div>
  )
}
