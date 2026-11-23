import { useEffect, type ReactNode } from 'react'
import { IconX } from '../icons'

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="muted small">{subtitle}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрити">
            <IconX size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Badge({
  children,
  tone = 'muted'
}: {
  children: ReactNode
  tone?: string
}): React.ReactElement {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function ProgressBar({
  value,
  tone = 'green',
  thin = false
}: {
  value: number
  tone?: string
  thin?: boolean
}): React.ReactElement {
  return (
    <div className={`progress ${thin ? 'progress-thin' : ''}`} role="progressbar" aria-valuenow={value}>
      <div className={`progress-fill tone-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}): React.ReactElement {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint ? <span className="toggle-hint">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
    </label>
  )
}

export function Field({
  label,
  hint,
  children,
  inline
}: {
  label: string
  hint?: string
  children: ReactNode
  inline?: boolean
}): React.ReactElement {
  return (
    <div className={`field ${inline ? 'field-inline' : ''}`}>
      <div className="field-label">
        <label>{label}</label>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md'
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}): React.ReactElement {
  return (
    <div className={`segmented segmented-${size}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === value ? 'active' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }): React.ReactElement {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Завантаження" />
}

export function Empty({
  icon,
  title,
  text,
  action
}: {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}): React.ReactElement {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function ScoreRing({ score }: { score: number }): React.ReactElement {
  const tone = score >= 80 ? 'hot' : score >= 60 ? 'warm' : 'cool'
  return (
    <div className={`score-ring ${tone}`} title={`Оцінка вірусності: ${score}/100`}>
      <svg viewBox="0 0 44 44" width="46" height="46">
        <circle cx="22" cy="22" r="18" className="score-track" />
        <circle
          cx="22"
          cy="22"
          r="18"
          className="score-value"
          strokeDasharray={`${(Math.min(100, score) / 100) * 113} 113`}
        />
      </svg>
      <span>{score}</span>
    </div>
  )
}
