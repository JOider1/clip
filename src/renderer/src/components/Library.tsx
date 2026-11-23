import { useMemo, useState } from 'react'
import type { Job } from '../../../shared/types'
import { api } from '../api'
import {
  IconAlert,
  IconChevronRight,
  IconFilm,
  IconFolder,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconScissors,
  IconSparkles,
  IconTrash
} from '../icons'
import { STATUS, fmtBytes, fmtDate, fmtDuration, isBusy, jobSubtitle, SOURCE_LABEL } from '../utils'
import { Badge, Empty, ProgressBar } from './ui'

type Filter = 'all' | 'ready' | 'active' | 'error'

export function Library({
  jobs,
  clips,
  storageBytes,
  aiReady,
  onOpen,
  onNew,
  onRetry,
  onDelete,
  onOpenOutput
}: {
  jobs: Job[]
  clips: number
  storageBytes: number
  aiReady: boolean
  onOpen: (id: string) => void
  onNew: () => void
  onRetry: (id: string) => void
  onDelete: (id: string) => void
  onOpenOutput: () => void
}): React.ReactElement {
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs
    if (filter === 'ready') return jobs.filter((j) => j.status === 'ready')
    if (filter === 'error') return jobs.filter((j) => j.status === 'error')
    return jobs.filter((j) => isBusy(j))
  }, [jobs, filter])

  const momentCount = jobs.reduce((n, j) => n + j.moments.length, 0)

  const remove = (job: Job): void => {
    if (window.confirm(`Видалити проєкт «${job.title}»?\nГотові кліпи у папці залишаться.`)) {
      onDelete(job.id)
    }
  }

  return (
    <div className="page library">
      <header className="page-head">
        <div>
          <div className="eyebrow">Стрім → кліп</div>
          <h1>
            Стрім стає <span className="accent-text">кліпами</span>
          </h1>
          <p className="page-sub">
            Встав посилання на YouTube чи Twitch або додай файл — ClipForge сам знайде найяскравіші
            моменти, зробить субтитри та збере вертикальний кліп.
          </p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={onNew}>
          <IconPlus size={18} />
          Створити кліп
        </button>
      </header>

      <section className="hero">
        <div className="hero-main">
          <div className="hero-badge">
            <IconSparkles size={14} />
            {aiReady ? 'AI-редактор увімкнено' : 'Працює без API-ключа'}
          </div>
          <h2>Обери момент — решта автоматично</h2>
          <p>
            Транскрипція мовлення, оцінка вірусності, кадрування під 9:16, динамічні субтитри та
            обличчя стрімера зверху. Один клік — готовий MP4.
          </p>
          <div className="hero-actions">
            <button className="btn btn-dark" onClick={onNew}>
              <IconScissors size={17} />
              Нарізати стрім
            </button>
            <button className="btn btn-ghost" onClick={onOpenOutput}>
              <IconFolder size={17} />
              Відкрити папку
            </button>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="phone">
            <div className="phone-face">
              <span className="face-dot" />
            </div>
            <div className="phone-game">
              <span className="game-line" />
              <span className="game-caption">ЦЕ БУЛО БОЖЕВІЛЬНО</span>
            </div>
          </div>
          <div className="floating-score">
            <span>92</span>
            <small>вірусність</small>
          </div>
          <div className="floating-chip">9:16</div>
        </div>
        <div className="hero-stats">
          <div>
            <strong>{jobs.length}</strong>
            <span>проєктів</span>
          </div>
          <div>
            <strong>{clips}</strong>
            <span>кліпів</span>
          </div>
          <div>
            <strong>{momentCount}</strong>
            <span>моментів</span>
          </div>
          <div>
            <strong>{fmtBytes(storageBytes)}</strong>
            <span>на диску</span>
          </div>
        </div>
      </section>

      <section className="library-section">
        <div className="section-head">
          <h2>Проєкти</h2>
          <div className="filters">
            {(
              [
                ['all', 'Усі'],
                ['ready', 'Готові'],
                ['active', 'В обробці'],
                ['error', 'Помилки']
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={`filter-chip ${filter === value ? 'active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
                {value === 'all' ? ` ${jobs.length}` : ''}
              </button>
            ))}
          </div>
        </div>

        {!jobs.length ? (
          <div className="onboarding">
            <div className="onb-art">
              <IconPlay size={26} />
            </div>
            <h3>Ще немає жодного кліпу</h3>
            <p>Додай перше відео — це займе кілька хвилин, залежно від довжини стріму.</p>
            <div className="how-grid">
              <div>
                <span>01</span>
                <strong>Додай джерело</strong>
                <p>Посилання YouTube / Twitch або локальний файл.</p>
              </div>
              <div>
                <span>02</span>
                <strong>Обери момент</strong>
                <p>AI або евристика оцінять вірусність кожної сцени.</p>
              </div>
              <div>
                <span>03</span>
                <strong>Забери кліпи</strong>
                <p>Готові вертикальні MP4 із субтитрами у папці.</p>
              </div>
            </div>
            <button className="btn btn-primary" onClick={onNew}>
              <IconPlus size={17} />
              Додати відео
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            icon={<IconFilm size={26} />}
            title="Тут порожньо"
            text="У цій категорії ще немає проєктів."
          />
        ) : (
          <div className="job-grid">
            {filtered.map((job) => {
              const status = STATUS[job.status]
              return (
                <article key={job.id} className="job-card" onClick={() => onOpen(job.id)}>
                  <div className="job-thumb">
                    {job.thumbnailPath ? (
                      <img src={api.mediaUrl(job.thumbnailPath)} alt="" loading="lazy" />
                    ) : (
                      <div className="thumb-fallback">
                        <IconFilm size={26} />
                        <span>{job.sourceType === 'file' ? 'Локальний файл' : 'Очікує завантаження'}</span>
                      </div>
                    )}
                    <div className="thumb-top">
                      <span className={`platform platform-${job.sourceType}`}>
                        {SOURCE_LABEL[job.sourceType]}
                      </span>
                      <span className={`status status-${status.tone}`}>
                        {isBusy(job) ? <span className="pulse-dot" /> : null}
                        {status.label}
                      </span>
                    </div>
                    {job.clips.length > 0 ? (
                      <div className="thumb-clips">
                        <IconPlay size={12} /> {job.clips.length}
                      </div>
                    ) : null}
                    {isBusy(job) ? (
                      <div className="thumb-progress">
                        <ProgressBar value={job.progress} tone="green" thin />
                        <span>{job.progressLabel}</span>
                      </div>
                    ) : null}
                    <div className="thumb-hover">
                      Відкрити <IconChevronRight size={15} />
                    </div>
                  </div>
                  <div className="job-body">
                    <h3 title={job.title}>{job.title}</h3>
                    <div className="job-meta">
                      {job.duration ? <span>{fmtDuration(job.duration)}</span> : null}
                      {job.moments.length ? <span>{job.moments.length} моментів</span> : null}
                      <span>{fmtDate(job.createdAt)}</span>
                    </div>
                    {job.status === 'error' && job.error ? (
                      <p className="job-error">
                        <IconAlert size={13} /> {job.error.split('\n')[0]}
                      </p>
                    ) : (
                      <p className="job-hint">{jobSubtitle(job) || 'Готуємо матеріал…'}</p>
                    )}
                    <div className="job-actions" onClick={(e) => e.stopPropagation()}>
                      {job.status === 'error' || job.status === 'canceled' ? (
                        <button className="mini-btn" onClick={() => onRetry(job.id)}>
                          <IconRefresh size={14} /> Повторити
                        </button>
                      ) : (
                        <button className="mini-btn" onClick={() => onOpen(job.id)}>
                          <IconPlay size={13} /> Відкрити
                        </button>
                      )}
                      {job.clips.length ? (
                        <button
                          className="mini-btn ghost"
                          onClick={() => void api.showInFolder(job.clips[0].filePath)}
                        >
                          <IconFolder size={14} />
                        </button>
                      ) : null}
                      <button
                        className="mini-btn ghost danger"
                        onClick={() => remove(job)}
                        aria-label="Видалити"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <footer className="page-foot">
        <span>
          <IconSparkles size={13} /> Без API-ключа працює евристичний відбір: гучність, ключові
          слова та щільність мовлення.
        </span>
        <span>{fmtBytes(storageBytes)} зайнято кліпами</span>
      </footer>
    </div>
  )
}
