import type { Clip, Job } from '../../../shared/types'
import { api } from '../api'
import { IconFilm, IconFolder, IconPlay, IconScissors, IconTrash } from '../icons'
import { LAYOUT_LABEL, fmtDuration } from '../utils'
import { Empty } from './ui'

export function ClipsTab({
  job,
  selectedCount,
  onCreate,
  onOpenOutput,
  onToast
}: {
  job: Job
  selectedCount: number
  onCreate: () => void
  onOpenOutput: () => void
  onToast: (message: string) => void
}): React.ReactElement {
  if (!job.clips.length) {
    return (
      <Empty
        icon={<IconFilm size={26} />}
        title="Кліпів ще немає"
        text={
          selectedCount
            ? `Обрано ${selectedCount} моментів. Натисни «Створити кліпи» — і отримаєш готові вертикальні MP4.`
            : 'Спочатку обери моменти на вкладці «Моменти».'
        }
        action={
          selectedCount ? (
            <button className="btn btn-primary" onClick={onCreate}>
              <IconScissors size={16} />
              Створити {selectedCount} кліпів
            </button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="clips-tab">
      <div className="tab-toolbar">
        <div>
          <h2>Готові кліпи</h2>
          <p className="muted small">{job.clips.length} файлів · натисни на відео для перегляду</p>
        </div>
        <div className="toolbar-right">
          <button className="btn btn-ghost btn-sm" onClick={onOpenOutput}>
            <IconFolder size={15} />
            Папка з кліпами
          </button>
          {selectedCount ? (
            <button className="btn btn-primary btn-sm" onClick={onCreate}>
              <IconScissors size={15} />
              Ще {selectedCount}
            </button>
          ) : null}
        </div>
      </div>

      <div className="clip-grid">
        {job.clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} onToast={onToast} />
        ))}
      </div>
    </div>
  )
}

function ClipCard({ clip, onToast }: { clip: Clip; onToast: (message: string) => void }): React.ReactElement {
  const reveal = async (): Promise<void> => {
    try {
      await api.showInFolder(clip.filePath)
    } catch (err) {
      onToast((err as Error).message)
    }
  }

  return (
    <article className="clip-card">
      <div className="clip-video">
        <video
          src={api.mediaUrl(clip.filePath)}
          poster={clip.thumbPath ? api.mediaUrl(clip.thumbPath) : undefined}
          controls
          preload="metadata"
          playsInline
        />
        <span className="clip-badge">{clip.width}×{clip.height}</span>
      </div>
      <div className="clip-body">
        <h3 title={clip.title}>{clip.title}</h3>
        <div className="clip-meta">
          <span>{fmtDuration(clip.duration)}</span>
          <span>{LAYOUT_LABEL[clip.layoutId]}</span>
          <span>{new Date(clip.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="clip-actions">
          <button className="mini-btn" onClick={() => void api.openPath(clip.filePath)}>
            <IconPlay size={13} /> Відкрити
          </button>
          <button className="mini-btn ghost" onClick={() => void reveal()}>
            <IconFolder size={14} /> Папка
          </button>
        </div>
      </div>
    </article>
  )
}
