import { useMemo, useRef, useState } from 'react'
import type { Job } from '../../../shared/types'
import { api } from '../api'
import { IconClock, IconFolder, IconPlay, IconPlus, IconScissors } from '../icons'
import { fmtDuration, fmtRange } from '../utils'
import { Field } from './ui'

export function SourceTab({
  job,
  onToast,
  onAdded
}: {
  job: Job
  onToast: (message: string) => void
  onAdded: () => void
}): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [current, setCurrent] = useState(0)
  const [inPoint, setInPoint] = useState(0)
  const [outPoint, setOutPoint] = useState(Math.min(30, job.duration))
  const [adding, setAdding] = useState(false)

  const markers = useMemo(() => job.moments.slice(0, 40), [job.moments])

  const seek = (time: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(job.duration, time))
    setCurrent(video.currentTime)
    void video.play().catch(() => undefined)
  }

  const markStart = (): void => {
    const t = videoRef.current?.currentTime ?? current
    setInPoint(Number(t.toFixed(2)))
    if (outPoint <= t + 2) setOutPoint(Number(Math.min(job.duration, t + 30).toFixed(2)))
  }

  const markEnd = (): void => {
    const t = videoRef.current?.currentTime ?? current
    setOutPoint(Number(t.toFixed(2)))
    if (inPoint >= t - 2) setInPoint(Number(Math.max(0, t - 30).toFixed(2)))
  }

  const add = async (): Promise<void> => {
    setAdding(true)
    try {
      await api.addMoment(job.id, inPoint, outPoint)
      onToast('Момент додано вручну')
      onAdded()
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="source-tab">
      <div className="panel source-panel">
        <div className="panel-head">
          <div>
            <h2>Джерело</h2>
            <p className="muted small">Переглянь стрім і познач момент вручну</p>
          </div>
          <span className="canvas-tag">
            <IconClock size={14} /> {fmtDuration(job.duration)}
          </span>
        </div>

        {job.videoPath ? (
          <>
            <div className="source-player">
              <video
                ref={videoRef}
                src={api.mediaUrl(job.videoPath)}
                controls
                preload="metadata"
                onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              />
            </div>

            <div className="moment-strip">
              {markers.map((m) => (
                <button
                  key={m.id}
                  className={`strip-marker ${m.selected ? 'sel' : ''}`}
                  style={{
                    left: `${(m.start / Math.max(1, job.duration)) * 100}%`,
                    width: `${Math.max(0.35, ((m.end - m.start) / Math.max(1, job.duration)) * 100)}%`
                  }}
                  title={`${fmtRange(m.start, m.end)} · ${m.title}`}
                  onClick={() => seek(m.start)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="inline-error">Відео ще не завантажене</div>
        )}

        <div className="mark-row">
          <button className="btn btn-ghost" onClick={markStart}>
            <IconScissors size={16} />
            Початок · {fmtDuration(inPoint)}
          </button>
          <div className="inout-preview">
            <span>{fmtDuration(inPoint)}</span>
            <span className="dash">→</span>
            <span>{fmtDuration(outPoint)}</span>
            <small>{fmtDuration(Math.max(0, outPoint - inPoint))}</small>
          </div>
          <button className="btn btn-ghost" onClick={markEnd}>
            <IconScissors size={16} />
            Кінець · {fmtDuration(outPoint)}
          </button>
        </div>

        <div className="manual-grid">
          <Field label="Початок, сек">
            <input
              className="input"
              type="number"
              step="0.1"
              min={0}
              max={job.duration}
              value={inPoint}
              onChange={(e) => setInPoint(Number(e.target.value))}
            />
          </Field>
          <Field label="Кінець, сек">
            <input
              className="input"
              type="number"
              step="0.1"
              min={0}
              max={job.duration}
              value={outPoint}
              onChange={(e) => setOutPoint(Number(e.target.value))}
            />
          </Field>
          <button
            className="btn btn-primary"
            onClick={() => void add()}
            disabled={adding || outPoint - inPoint < 2}
          >
            <IconPlus size={16} />
            {adding ? 'Додаю…' : 'Додати момент'}
          </button>
          <button className="btn btn-ghost" onClick={() => seek(inPoint)}>
            <IconPlay size={15} />
            Перевірити
          </button>
        </div>
        <p className="hint muted">
          Постав курсор на початок і натисни «Початок», потім на кінець — «Кінець». Оптимально
          15–60 секунд. Доданий момент з'явиться на вкладці «Моменти» з оцінкою 100.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Моменти у проєкті</h2>
          <span className="muted small">{job.moments.length}</span>
        </div>
        <div className="source-moment-list">
          {job.moments.length ? (
            job.moments.map((m) => (
              <button key={m.id} className="source-moment" onClick={() => seek(m.start)}>
                <span className="sm-time">{fmtRange(m.start, m.end)}</span>
                <span className="sm-title">{m.title}</span>
                <span className={`sm-score ${m.selected ? '' : 'off'}`}>{m.score}</span>
              </button>
            ))
          ) : (
            <p className="muted small">Ще немає моментів</p>
          )}
        </div>
      </div>

      <div className="panel facts-panel">
        <h2>Параметри джерела</h2>
        <div className="fact-grid">
          <div>
            <span>Формат</span>
            <strong>{job.width}×{job.height}</strong>
          </div>
          <div>
            <span>FPS</span>
            <strong>{job.fps ? job.fps.toFixed(1) : '—'}</strong>
          </div>
          <div>
            <span>Тривалість</span>
            <strong>{fmtDuration(job.duration)}</strong>
          </div>
          <div>
            <span>Тип</span>
            <strong>{job.sourceUrl ? 'Посилання' : 'Файл'}</strong>
          </div>
        </div>
        {job.videoPath ? (
          <button className="btn btn-ghost btn-sm" onClick={() => void api.showInFolder(job.videoPath!)}>
            <IconFolder size={15} />
            Показати файл
          </button>
        ) : null}
      </div>
    </div>
  )
}
