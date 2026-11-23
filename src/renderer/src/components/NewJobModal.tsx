import { useEffect, useState } from 'react'
import type { ClipJobPayload, CreateJobOptions, LayoutId, Settings } from '../../../shared/types'
import { LAYOUTS } from '../../../shared/defaults'
import { api } from '../api'
import { detectUrlType } from '../utils'
import { IconFile, IconLink, IconSparkles, IconUpload } from '../icons'
import { Field, Modal, Segmented, Spinner } from './ui'
import { LayoutThumb } from './LayoutThumb'

export function NewJobModal({
  settings,
  onClose,
  onCreate,
  onOpenSettings
}: {
  settings: Settings
  onClose: () => void
  onCreate: (payload: ClipJobPayload, options: CreateJobOptions) => Promise<void>
  onOpenSettings: () => void
}): React.ReactElement {
  const [tab, setTab] = useState<'url' | 'file'>('url')
  const [url, setUrl] = useState('')
  const [filePath, setFilePath] = useState('')
  const [count, setCount] = useState(settings.clipDefaults.count)
  const [minDuration, setMin] = useState(settings.clipDefaults.minDuration)
  const [maxDuration, setMax] = useState(settings.clipDefaults.maxDuration)
  const [layoutId, setLayoutId] = useState<LayoutId>(settings.clipDefaults.layoutId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const aiReady = settings.ai.enabled && Boolean(settings.ai.apiKey)
  const detected = tab === 'url' ? detectUrlType(url) : 'file'

  useEffect(() => {
    setError(null)
  }, [tab])

  const pickFile = async (): Promise<void> => {
    const picked = await api.pickFile('video')
    if (picked) setFilePath(picked)
  }

  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch {
      setError('Не вдалося прочитати буфер обміну — встав посилання вручну')
    }
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (tab === 'url') {
      if (!/^https?:\/\//i.test(url.trim())) {
        setError('Встав повне посилання, наприклад https://youtube.com/watch?v=…')
        return
      }
    } else if (!filePath) {
      setError('Обери відеофайл на диску')
      return
    }
    if (minDuration >= maxDuration) {
      setError('Мінімальна довжина має бути меншою за максимальну')
      return
    }
    setBusy(true)
    try {
      const payload: ClipJobPayload =
        tab === 'url' ? { kind: 'url', url: url.trim() } : { kind: 'file', filePath }
      await onCreate(payload, {
        count,
        minDuration,
        maxDuration,
        layoutId,
        subtitle: settings.clipDefaults.subtitle
      })
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+':\s*/, ''))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Новий кліп"
      subtitle="Додай джерело — далі все автоматично"
      onClose={onClose}
      width={660}
      footer={
        <>
          <div className={`mode-inline ${aiReady ? 'ok' : ''}`}>
            <IconSparkles size={15} />
            {aiReady ? `AI: ${settings.ai.model}` : 'Евристичний відбір (без API-ключа)'}
            {!aiReady ? (
              <button className="inline-link" onClick={onOpenSettings}>
                налаштувати
              </button>
            ) : null}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Скасувати
            </button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? <Spinner /> : <IconSparkles size={17} />}
              {busy ? 'Створюю…' : 'Аналізувати'}
            </button>
          </div>
        </>
      }
    >
      <div className="segmented segmented-tabs">
        <button className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')}>
          <IconLink size={16} /> YouTube / Twitch
        </button>
        <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
          <IconFile size={16} /> Файл відео
        </button>
      </div>

      {tab === 'url' ? (
        <div className="new-source">
          <Field label="Посилання на відео" hint="VOD, стрім або кліп">
            <div className="input-row">
              <input
                className="input input-lg"
                placeholder="https://www.youtube.com/watch?v=… або https://twitch.tv/videos/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
                spellCheck={false}
              />
              <button className="btn btn-ghost" onClick={() => void paste()} disabled={busy}>
                Вставити
              </button>
            </div>
          </Field>
          <div className="source-hints">
            <span className={`platform platform-${detected}`}>
              {detected === 'youtube' ? 'YouTube' : detected === 'twitch' ? 'Twitch' : 'Посилання'}
            </span>
            <span>Завантаження через yt-dlp · до 1080p</span>
            {detected === 'twitch' ? <span>Кліпи Twitch підтримуються</span> : null}
          </div>
        </div>
      ) : (
        <div className="new-source">
          <button className={`file-drop ${filePath ? 'has-file' : ''}`} onClick={() => void pickFile()}>
            <span className="file-drop-icon">
              <IconUpload size={22} />
            </span>
            {filePath ? (
              <>
                <strong>{filePath.split(/[\\/]/).pop()}</strong>
                <span className="file-path">{filePath}</span>
              </>
            ) : (
              <>
                <strong>Обери відеофайл</strong>
                <span>MP4, MKV, MOV, WebM, AVI, TS — будь-яка довжина</span>
              </>
            )}
          </button>
          <p className="hint muted">
            Файл не копіюється: обробка йде напряму з диска. Для вебки обери шаблон із зоною
            обличчя.
          </p>
        </div>
      )}

      <div className="new-grid">
        <Field label="Скільки моментів знайти" hint={`${count}`}>
          <input
            className="range"
            type="range"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <Field label="Довжина кліпу, сек">
          <div className="two-inputs">
            <input
              className="input"
              type="number"
              min={5}
              max={120}
              value={minDuration}
              onChange={(e) => setMin(Number(e.target.value))}
            />
            <span>—</span>
            <input
              className="input"
              type="number"
              min={8}
              max={300}
              value={maxDuration}
              onChange={(e) => setMax(Number(e.target.value))}
            />
          </div>
        </Field>
      </div>

      <Field label="Шаблон кадру">
        <div className="layout-picker">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              className={`layout-option ${layoutId === l.id ? 'active' : ''}`}
              onClick={() => setLayoutId(l.id)}
              title={l.hint}
            >
              <LayoutThumb id={l.id} active={layoutId === l.id} />
              <span>{l.name}</span>
            </button>
          ))}
        </div>
      </Field>

      {error ? <div className="inline-error">{error}</div> : null}
    </Modal>
  )
}
