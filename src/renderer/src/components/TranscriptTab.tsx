import { useMemo, useState } from 'react'
import type { Job, TranscriptSegment } from '../../../shared/types'
import { api } from '../api'
import { IconCaptions, IconCopy, IconDownload, IconPlay, IconRefresh, IconSearch, IconWand } from '../icons'
import { fmtDuration } from '../utils'
import { Empty, Spinner } from './ui'

export function TranscriptTab({
  job,
  onToast,
  onAnalyze,
  onPlaySegment
}: {
  job: Job
  onToast: (message: string) => void
  onAnalyze: () => void
  onPlaySegment: (segment: TranscriptSegment) => void
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? job.transcript.filter((s) => s.text.toLowerCase().includes(q)) : job.transcript
    return list.slice(0, 600)
  }, [job.transcript, query])

  const words = useMemo(
    () => job.transcript.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0),
    [job.transcript]
  )

  const transcribe = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.transcribeJob(job.id)
      onToast('Транскрипцію завершено')
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const importSrt = async (): Promise<void> => {
    const file = await api.pickFile('srt')
    if (!file) return
    setBusy(true)
    try {
      await api.transcribeJob(job.id, file)
      onToast('Субтитри імпортовано — можна переаналізувати моменти')
      onAnalyze()
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copyAll = (): void => {
    const text = job.transcript
      .map((s) => `[${fmtDuration(s.start)}] ${s.text}`)
      .join('\n')
    void navigator.clipboard.writeText(text).then(
      () => onToast('Текст скопійовано'),
      () => onToast('Не вдалося скопіювати')
    )
  }

  if (!job.transcript.length) {
    return (
      <Empty
        icon={<IconCaptions size={26} />}
        title="Транскрипту ще немає"
        text="Субтитри створюються з мовлення стріму. Увімкни STT у налаштуваннях (OpenAI / Groq Whisper, локальний whisper.cpp) або імпортуй готовий SRT."
        action={
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={() => void transcribe()} disabled={busy}>
              {busy ? <Spinner size={15} /> : <IconCaptions size={16} />}
              {busy ? 'Транскрибую…' : 'Транскрибувати'}
            </button>
            <button className="btn btn-ghost" onClick={() => void importSrt()} disabled={busy}>
              <IconDownload size={16} />
              Імпортувати SRT
            </button>
          </div>
        }
      />
    )
  }

  return (
    <div className="transcript-tab">
      <div className="tab-toolbar">
        <div>
          <h2>Транскрипт</h2>
          <p className="muted small">
            {job.transcript.length} сегментів · {words} слів · {fmtDuration(job.transcript[job.transcript.length - 1].end)} покрито
          </p>
        </div>
        <div className="toolbar-right">
          <div className="search-box">
            <IconSearch size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук по тексту…"
            />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={copyAll}>
            <IconCopy size={14} />
            Копіювати
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void importSrt()} disabled={busy}>
            <IconDownload size={14} />
            SRT
          </button>
          <button className="btn btn-primary btn-sm" onClick={onAnalyze} disabled={busy}>
            <IconWand size={14} />
            Переаналізувати
          </button>
        </div>
      </div>

      <div className="transcript-list">
        {filtered.map((segment) => (
          <div key={segment.id} className="transcript-row">
            <button className="tr-time" onClick={() => onPlaySegment(segment)}>
              <IconPlay size={11} />
              {fmtDuration(segment.start)}
            </button>
            <p>{highlight(segment.text, query)}</p>
            <span className="tr-dur">{(segment.end - segment.start).toFixed(1)} с</span>
          </div>
        ))}
        {!filtered.length ? <p className="muted small">Нічого не знайдено</p> : null}
        {query && job.transcript.filter((s) => s.text.toLowerCase().includes(query.toLowerCase())).length > 600 ? (
          <p className="muted small">Показано перші 600 результатів</p>
        ) : null}
      </div>

      <div className="transcript-foot">
        <span>
          <IconRefresh size={13} /> Транскрипт використовується для субтитрів і пошуку моментів.
        </span>
        <button className="link-btn" onClick={() => void transcribe()} disabled={busy}>
          {busy ? 'Транскрибую…' : 'Перезаписати транскрипт'}
        </button>
      </div>
    </div>
  )
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0
  let index = lower.indexOf(needle)
  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index))
    parts.push(<mark key={`${index}-${parts.length}`}>{text.slice(index, index + needle.length)}</mark>)
    cursor = index + needle.length
    index = lower.indexOf(needle, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
