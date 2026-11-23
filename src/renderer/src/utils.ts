import React from 'react'
import type { Job, JobStatus, LayoutId, SourceType } from '../../shared/types'

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtRange(start: number, end: number): string {
  return `${fmtDuration(start)} – ${fmtDuration(end)}`
}

export function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 МБ'
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} КБ`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`
}

export const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  queued: { label: 'У черзі', tone: 'muted' },
  downloading: { label: 'Завантаження', tone: 'blue' },
  probing: { label: 'Аналіз', tone: 'blue' },
  transcribing: { label: 'Транскрипція', tone: 'violet' },
  analyzing: { label: 'Пошук моментів', tone: 'violet' },
  rendering: { label: 'Рендер', tone: 'amber' },
  ready: { label: 'Готово', tone: 'green' },
  error: { label: 'Помилка', tone: 'red' },
  canceled: { label: 'Скасовано', tone: 'muted' }
}

export const SOURCE_LABEL: Record<SourceType, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  file: 'Файл',
  other: 'Посилання'
}

export const LAYOUT_LABEL: Record<LayoutId, string> = {
  'face-top': 'Обличчя зверху',
  'face-bottom': 'Обличчя знизу',
  pip: 'Вебка в куті',
  'clean-vertical': 'Геймплей 9:16',
  horizontal: 'Горизонталь 16:9'
}

export function isBusy(job: Job): boolean {
  return ['queued', 'downloading', 'probing', 'transcribing', 'analyzing', 'rendering'].includes(
    job.status
  )
}

export function jobSubtitle(job: Job): string {
  const parts: string[] = []
  if (job.duration) parts.push(fmtDuration(job.duration))
  if (job.moments.length) parts.push(`${job.moments.length} моментів`)
  if (job.clips.length) parts.push(`${job.clips.length} кліпів`)
  return parts.join(' · ')
}

export function scoreTone(score: number): string {
  if (score >= 80) return 'hot'
  if (score >= 60) return 'warm'
  return 'cool'
}

export function detectUrlType(url: string): 'youtube' | 'twitch' | 'other' {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube'
    if (host.includes('twitch.tv')) return 'twitch'
  } catch {
    /* ignore */
  }
  return 'other'
}

export function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  delay: number
): T {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = React.useRef(callback)
  cb.current = callback
  return React.useCallback(
    ((...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => cb.current(...args), delay)
    }) as T,
    [delay]
  )
}
