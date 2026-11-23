import { useEffect, useMemo, useState } from 'react'
import type { Job, Moment } from '../../../shared/types'
import { api } from '../api'
import { IconAlert, IconPlay, IconSparkles, IconTrash, IconWand } from '../icons'
import { fmtDuration, fmtRange, scoreTone } from '../utils'
import { Empty, ScoreRing, Segmented } from './ui'

export function MomentsTab({
  job,
  onPlay,
  onToast,
  onAnalyze
}: {
  job: Job
  onPlay: (moment: Moment) => void
  onToast: (message: string) => void
  onAnalyze: () => void
}): React.ReactElement {
  const [sort, setSort] = useState<'score' | 'time'>('score')
  const selected = job.moments.filter((m) => m.selected)

  const sorted = useMemo(() => {
    const list = [...job.moments]
    list.sort((a, b) => (sort === 'score' ? b.score - a.score : a.start - b.start))
    return list
  }, [job.moments, sort])

  const selectAll = (value: boolean): void => {
    void api.selectMoments(
      job.id,
      value ? job.moments.map((m) => m.id) : []
    )
  }

  if (!job.moments.length) {
    const busy = ['queued', 'downloading', 'probing', 'transcribing', 'analyzing'].includes(job.status)
    return (
      <Empty
        icon={<IconSparkles size={26} />}
        title={busy ? 'Шукаємо найкращі моменти…' : 'Моментів ще немає'}
        text={
          busy
            ? 'Це може зайняти кілька хвилин. Прогрес видно у шапці проєкту.'
            : 'Запусти аналіз, або додай момент вручну на вкладці «Джерело».'
        }
        action={
          busy ? undefined : (
            <button className="btn btn-primary" onClick={onAnalyze}>
              <IconWand size={16} />
              Проаналізувати
            </button>
          )
        }
      />
    )
  }

  return (
    <div className="moments-tab">
      <div className="tab-toolbar">
        <div>
          <h2>Знайдені моменти</h2>
          <p className="muted small">
            {job.aiUsed ? 'Оцінено AI за сценарієм вірусності' : 'Оцінено евристикою: гучність + слова'}
            {' · '}
            {job.moments.length} всього
          </p>
        </div>
        <div className="toolbar-right">
          <Segmented
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'score', label: 'За оцінкою' },
              { value: 'time', label: 'За часом' }
            ]}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => selectAll(selected.length < job.moments.length)}>
            {selected.length < job.moments.length ? 'Обрати всі' : 'Зняти всі'}
          </button>
        </div>
      </div>

      <div className="moment-list">
        {sorted.map((moment) => (
          <MomentCard
            key={moment.id}
            job={job}
            moment={moment}
            onPlay={() => onPlay(moment)}
            onToast={onToast}
          />
        ))}
      </div>
    </div>
  )
}

function MomentCard({
  job,
  moment,
  onPlay,
  onToast
}: {
  job: Job
  moment: Moment
  onPlay: () => void
  onToast: (message: string) => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(moment.start)
  const [end, setEnd] = useState(moment.end)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) {
      setStart(moment.start)
      setEnd(moment.end)
    }
  }, [moment.start, moment.end, editing])

  const toggle = (): void => {
    void api.updateMoment(job.id, moment.id, { selected: !moment.selected })
  }

  const save = async (): Promise<void> => {
    const s = Math.max(0, Math.min(start, job.duration - 1))
    const e = Math.max(s + 2, Math.min(end, job.duration))
    setSaving(true)
    try {
      await api.updateMoment(job.id, moment.id, { start: s, end: e })
      setEditing(false)
      onToast('Таймкоди оновлено')
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = (): void => {
    void api.removeMoment(job.id, moment.id)
    onToast('Момент видалено')
  }

  return (
    <article className={`moment-card ${moment.selected ? 'selected' : ''}`}>
      <button
        className={`moment-check ${moment.selected ? 'on' : ''}`}
        onClick={toggle}
        aria-label={moment.selected ? 'Зняти вибір' : 'Обрати момент'}
      >
        {moment.selected ? '✓' : ''}
      </button>

      <ScoreRing score={moment.score} />

      <div className="moment-main">
        <div className="moment-top">
          <h3>{moment.title}</h3>
          <span className="moment-time">{fmtRange(moment.start, moment.end)}</span>
        </div>
        {moment.hook ? <div className="moment-hook">«{moment.hook}»</div> : null}
        <p className="moment-reason">{moment.reason}</p>
        <div className="moment-tags">
          <span className={`score-tag ${scoreTone(moment.score)}`}>{fmtDuration(moment.end - moment.start)}</span>
          <span className="tag">
            {moment.source === 'ai' ? 'AI' : moment.source === 'manual' ? 'Вручну' : 'Евристика'}
          </span>
          {moment.tags.map((tag) => (
            <span key={tag} className="tag subtle">
              #{tag}
            </span>
          ))}
        </div>

        {editing ? (
          <div className="moment-edit">
            <label>
              Початок
              <input
                type="number"
                step="0.1"
                min={0}
                max={job.duration}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </label>
            <label>
              Кінець
              <input
                type="number"
                step="0.1"
                min={0}
                max={job.duration}
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
              />
            </label>
            <button className="btn btn-primary btn-xs" onClick={() => void save()} disabled={saving}>
              Зберегти
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => setEditing(false)}>
              Скасувати
            </button>
            {end - start > 90 ? <span className="hint">Довгувати кліп понад 90 с не рекомендуємо</span> : null}
          </div>
        ) : null}
      </div>

      <div className="moment-actions">
        <button className="icon-btn" onClick={onPlay} title="Переглянути момент">
          <IconPlay size={16} />
        </button>
        <button
          className={`icon-btn ${editing ? 'active' : ''}`}
          onClick={() => setEditing(!editing)}
          title="Редагувати таймкоди"
        >
          <IconAlert size={15} className="rotate-45" />
        </button>
        <button className="icon-btn danger" onClick={remove} title="Видалити момент">
          <IconTrash size={15} />
        </button>
      </div>
    </article>
  )
}
