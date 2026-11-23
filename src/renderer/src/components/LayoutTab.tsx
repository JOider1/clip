import { useEffect, useRef, useState } from 'react'
import type { Job, LayoutConfig, LayoutId, Rect, SubtitleStyle } from '../../../shared/types'
import { LAYOUTS, defaultLayoutFor } from '../../../shared/defaults'
import { api } from '../api'
import { clamp } from '../utils'
import { IconCaptions, IconCheck, IconCrop, IconRefresh, IconWand } from '../icons'
import { Field, Segmented, Spinner, Toggle } from './ui'
import { LayoutThumb } from './LayoutThumb'

export function LayoutTab({
  job,
  layout,
  subtitle,
  burnSubtitles,
  setLayout,
  setSubtitle,
  setBurnSubtitles,
  onToast
}: {
  job: Job
  layout: LayoutConfig
  subtitle: SubtitleStyle
  burnSubtitles: boolean
  setLayout: (l: LayoutConfig) => void
  setSubtitle: (s: SubtitleStyle) => void
  setBurnSubtitles: (v: boolean) => void
  onToast: (message: string) => void
}): React.ReactElement {
  const initialTime = Math.min(
    job.duration - 2,
    (job.moments.find((m) => m.selected)?.start ?? job.duration * 0.3) + 2
  )
  const [frameTime, setFrameTime] = useState(Math.max(0, initialTime))
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [frameLoading, setFrameLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [activeRegion, setActiveRegion] = useState<'face' | 'game'>('face')
  const [showFace, setShowFace] = useState(Boolean(layout.faceRect))
  const [showGame, setShowGame] = useState(Boolean(layout.gameRect))

  const loadFrame = async (time: number): Promise<void> => {
    setFrameLoading(true)
    try {
      const path = await api.extractFrame(job.id, time)
      setFrameUrl(`${api.mediaUrl(path)}?v=${Date.now()}`)
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setFrameLoading(false)
    }
  }

  useEffect(() => {
    if (!job.videoPath) return
    void loadFrame(frameTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])

  useEffect(() => {
    setShowFace(Boolean(layout.faceRect))
    setShowGame(Boolean(layout.gameRect))
  }, [layout.faceRect, layout.gameRect])

  useEffect(() => {
    if (!job.videoPath) return
    const timer = setTimeout(() => {
      void loadFrame(frameTime)
    }, 550)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameTime])

  const chooseLayout = (id: LayoutId): void => {
    const next = defaultLayoutFor(id, job.width / Math.max(1, job.height))
    setLayout(next)
    setPreviewUrl(null)
  }

  const setFaceRect = (rect: Rect | null): void => {
    setLayout({ ...layout, faceRect: rect })
    setPreviewUrl(null)
  }

  const setGameRect = (rect: Rect | null): void => {
    setLayout({ ...layout, gameRect: rect })
    setPreviewUrl(null)
  }

  const runPreview = async (): Promise<void> => {
    setPreviewLoading(true)
    try {
      const path = await api.previewLayout({
        jobId: job.id,
        layout,
        subtitle,
        burnSubtitles,
        time: frameTime
      })
      setPreviewUrl(`${api.mediaUrl(path)}?v=${Date.now()}`)
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setPreviewLoading(false)
    }
  }

  const supportsFace = layout.id !== 'clean-vertical' && layout.id !== 'horizontal'
  const hasTranscript = job.transcript.length > 0

  return (
    <div className="layout-tab">
      <div className="layout-left">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Шаблон кадру</h2>
              <p className="muted small">Обери композицію та відкалібруй зони на кадрі</p>
            </div>
            <span className="canvas-tag">
              <IconCrop size={14} /> {layout.id === 'horizontal' ? '1920×1080' : '1080×1920'}
            </span>
          </div>

          <div className="layout-picker">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={`layout-option ${layout.id === l.id ? 'active' : ''}`}
                onClick={() => chooseLayout(l.id)}
                title={l.hint}
              >
                <LayoutThumb id={l.id} active={layout.id === l.id} />
                <span>{l.name}</span>
              </button>
            ))}
          </div>

          <div className="frame-tools">
            <div className="time-scrub">
              <span className="mono">{Math.floor(frameTime / 60)}:{String(Math.floor(frameTime % 60)).padStart(2, '0')}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, job.duration - 0.5)}
                step={0.5}
                value={frameTime}
                onChange={(e) => setFrameTime(Number(e.target.value))}
              />
              <span className="muted small">кадр для калібрування</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => void loadFrame(frameTime)} disabled={frameLoading}>
              {frameLoading ? <Spinner size={14} /> : <IconRefresh size={14} />}
              Оновити кадр
            </button>
          </div>

          {frameUrl ? (
            <FrameEditor
              imageUrl={frameUrl}
              layout={layout}
              active={activeRegion}
              setActive={setActiveRegion}
              onChangeFace={setFaceRect}
              onChangeGame={setGameRect}
            />
          ) : (
            <div className="frame-placeholder">
              {frameLoading ? <Spinner size={22} /> : <IconCrop size={26} />}
              <span>Завантажую кадр із відео…</span>
            </div>
          )}

          <div className="region-controls">
            <label className={`region-toggle ${supportsFace ? '' : 'disabled'}`}>
              <input
                type="checkbox"
                checked={Boolean(layout.faceRect)}
                disabled={!supportsFace}
                onChange={(e) =>
                  setFaceRect(
                    e.target.checked
                      ? { x: 0.7, y: 0.66, w: 0.3, h: 0.32 }
                      : null
                  )
                }
              />
              <span className="swatch face" />
              Зона вебки / обличчя
            </label>
            <label className="region-toggle">
              <input
                type="checkbox"
                checked={Boolean(layout.gameRect)}
                onChange={(e) =>
                  setGameRect(
                    e.target.checked ? { x: 0.1, y: 0.08, w: 0.8, h: 0.84 } : null
                  )
                }
              />
              <span className="swatch game" />
              Обмежити зону геймплею
            </label>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setLayout(defaultLayoutFor(layout.id, job.width / Math.max(1, job.height)))
                setPreviewUrl(null)
              }}
            >
              Скинути рамки
            </button>
          </div>
          <p className="hint muted">
            {layout.faceRect
              ? 'Тягни рамку обличчя — це частина кадру, яка піде окремим блоком. Для стрімів із вебкою в куті постав рамку точно на неї.'
              : 'Вебка не обрана — шаблон покаже лише геймплей. Увімкни зону обличчя, якщо на стрімі є камера.'}
          </p>
        </div>
      </div>

      <div className="layout-right">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Субтитри</h2>
              <p className="muted small">Стиль, розмір і позиція на кадрі</p>
            </div>
            <IconCaptions size={19} />
          </div>

          <Toggle
            checked={burnSubtitles}
            onChange={setBurnSubtitles}
            label="Впалювати субтитри у відео"
            hint={hasTranscript ? `${job.transcript.length} сегментів транскрипту` : 'Спочатку потрібна транскрипція'}
          />

          <Field label="Стиль">
            <Segmented
              size="sm"
              value={subtitle.preset}
              onChange={(preset) => setSubtitle({ ...subtitle, preset })}
              options={[
                { value: 'bold', label: 'Жирний' },
                { value: 'boxed', label: 'Плашка' },
                { value: 'karaoke', label: 'Караоке' },
                { value: 'minimal', label: 'Мінімал' }
              ]}
            />
          </Field>

          <div className="two-fields">
            <Field label="Шрифт">
              <select
                className="input"
                value={subtitle.fontFamily}
                onChange={(e) => setSubtitle({ ...subtitle, fontFamily: e.target.value })}
              >
                {['Arial Black', 'Arial', 'Impact', 'Segoe UI', 'Tahoma', 'Verdana'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Колір акценту">
              <div className="color-input">
                <input
                  type="color"
                  value={subtitle.accent}
                  onChange={(e) => setSubtitle({ ...subtitle, accent: e.target.value })}
                />
                <code>{subtitle.accent.toUpperCase()}</code>
              </div>
            </Field>
          </div>

          <Field label="Розмір шрифту" hint={`${subtitle.fontSize}px`}>
            <input
              className="range"
              type="range"
              min={36}
              max={120}
              value={subtitle.fontSize}
              onChange={(e) => setSubtitle({ ...subtitle, fontSize: Number(e.target.value) })}
            />
          </Field>

          <div className="two-fields">
            <Field label="Позиція">
              <Segmented
                size="sm"
                value={subtitle.position}
                onChange={(position) => setSubtitle({ ...subtitle, position })}
                options={[
                  { value: 'bottom', label: 'Знизу' },
                  { value: 'center', label: 'Центр' },
                  { value: 'top', label: 'Зверху' }
                ]}
              />
            </Field>
            <Field label="Слів у репліці" hint={`${subtitle.maxWords}`}>
              <input
                className="range"
                type="range"
                min={2}
                max={7}
                value={subtitle.maxWords}
                onChange={(e) => setSubtitle({ ...subtitle, maxWords: Number(e.target.value) })}
              />
            </Field>
          </div>

          <Toggle
            checked={subtitle.uppercase}
            onChange={(uppercase) => setSubtitle({ ...subtitle, uppercase })}
            label="ВЕЛИКІ ЛІТЕРИ"
            hint="Класичний стиль TikTok"
          />

          <div className="caption-demo" style={{ ['--accent' as string]: subtitle.accent }}>
            <span style={{ fontFamily: subtitle.fontFamily, fontSize: `${Math.min(28, subtitle.fontSize / 3)}px` }}>
              {subtitle.uppercase ? 'ЦЕ БУЛО БОЖЕВІЛЬНО' : 'Це було божевільно'}
            </span>
          </div>
        </div>

        <div className="panel preview-panel">
          <div className="panel-head">
            <div>
              <h2>Прев'ю</h2>
              <p className="muted small">Один кадр із накладеним шаблоном і субтитрами</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void runPreview()} disabled={previewLoading}>
              {previewLoading ? <Spinner size={14} /> : <IconWand size={15} />}
              {previewLoading ? 'Рендер…' : 'Зробити прев\'ю'}
            </button>
          </div>
          <div className="preview-box">
            {previewUrl ? (
              <img src={previewUrl} alt="Прев'ю шаблону" />
            ) : (
              <div className="preview-empty">
                <IconWand size={22} />
                <span>Натисни «Зробити прев'ю», щоб побачити фінальний кадр</span>
                {!hasTranscript ? <small>Без транскрипту субтитри не з'являться</small> : null}
              </div>
            )}
          </div>
          <div className="preview-meta">
            <span>
              <IconCheck size={13} /> {layout.faceRect ? 'Вебка окремо' : 'Без вебки'}
            </span>
            <span>
              <IconCheck size={13} /> {burnSubtitles && hasTranscript ? 'Субтитри увімкнено' : 'Без субтитрів'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function FrameEditor({
  imageUrl,
  layout,
  active,
  setActive,
  onChangeFace,
  onChangeGame
}: {
  imageUrl: string
  layout: LayoutConfig
  active: 'face' | 'game'
  setActive: (r: 'face' | 'game') => void
  onChangeFace: (r: Rect | null) => void
  onChangeGame: (r: Rect | null) => void
}): React.ReactElement {
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    mode: 'move' | 'resize'
    target: 'face' | 'game'
    startX: number
    startY: number
    rect: Rect
  } | null>(null)

  const begin = (
    e: React.PointerEvent,
    target: 'face' | 'game',
    mode: 'move' | 'resize'
  ): void => {
    e.preventDefault()
    e.stopPropagation()
    const rect = target === 'face' ? layout.faceRect : layout.gameRect
    if (!rect) return
    setActive(target)
    dragRef.current = { mode, target, startX: e.clientX, startY: e.clientY, rect: { ...rect } }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    const box = boxRef.current
    if (!drag || !box) return
    const bounds = box.getBoundingClientRect()
    const dx = (e.clientX - drag.startX) / Math.max(1, bounds.width)
    const dy = (e.clientY - drag.startY) / Math.max(1, bounds.height)
    const next = { ...drag.rect }
    if (drag.mode === 'move') {
      next.x = clamp(drag.rect.x + dx, 0, 1 - drag.rect.w)
      next.y = clamp(drag.rect.y + dy, 0, 1 - drag.rect.h)
    } else {
      next.w = clamp(drag.rect.w + dx, 0.05, 1 - drag.rect.x)
      next.h = clamp(drag.rect.h + dy, 0.05, 1 - drag.rect.y)
    }
    if (drag.target === 'face') onChangeFace(next)
    else onChangeGame(next)
  }

  const end = (e: React.PointerEvent): void => {
    dragRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const styleFor = (r: Rect): React.CSSProperties => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`
  })

  return (
    <div className="frame-editor" ref={boxRef}>
      <img src={imageUrl} alt="Кадр відео" draggable={false} />
      {layout.gameRect ? (
        <div
          className={`editor-rect game ${active === 'game' ? 'active' : ''}`}
          style={styleFor(layout.gameRect)}
          onPointerDown={(e) => begin(e, 'game', 'move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="rect-label">геймплей</span>
          <span
            className="rect-handle"
            onPointerDown={(e) => begin(e, 'game', 'resize')}
            onPointerMove={(e) => {
              e.stopPropagation()
              move(e)
            }}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </div>
      ) : null}
      {layout.faceRect ? (
        <div
          className={`editor-rect face ${active === 'face' ? 'active' : ''}`}
          style={styleFor(layout.faceRect)}
          onPointerDown={(e) => begin(e, 'face', 'move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="rect-label">обличчя</span>
          <span
            className="rect-handle"
            onPointerDown={(e) => begin(e, 'face', 'resize')}
            onPointerMove={(e) => {
              e.stopPropagation()
              move(e)
            }}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </div>
      ) : null}
      <span className="editor-tip">Тягни рамки · кут — змінити розмір</span>
    </div>
  )
}
