import fs from 'node:fs'
import path from 'node:path'
import type { SttSettings, TranscriptSegment, TranscriptWord } from '../../shared/types'
import { ffmpeg, run, fileExists } from './media'

export interface TranscribeResult {
  segments: TranscriptSegment[]
  language?: string
  note?: string
}

const MAX_UPLOAD_BYTES = 23 * 1024 * 1024
const CHUNK_SECONDS = 600

function normalizeSegments(
  raw: Array<{ start: number; end: number; text: string; words?: TranscriptWord[] }>
): TranscriptSegment[] {
  const cleaned = raw
    .map((s) => ({
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(0, Number(s.end) || 0),
      text: (s.text || '').replace(/\s+/g, ' ').trim(),
      words: s.words?.filter((w) => w.text && Number.isFinite(w.start))
    }))
    .filter((s) => s.text && s.end > s.start)

  cleaned.sort((a, b) => a.start - b.start)
  return cleaned.map((s, i) => ({
    id: i,
    start: round(s.start),
    end: round(s.end),
    text: s.text,
    words: s.words?.length
      ? s.words.map((w) => ({ start: round(w.start), end: round(w.end), text: w.text.trim() }))
      : undefined
  }))
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

async function postTranscription(
  baseUrl: string,
  apiKey: string,
  model: string,
  language: string,
  filePath: string,
  withWords: boolean,
  signal?: AbortSignal
): Promise<{ status: number; json: unknown; text: string }> {
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`
  const form = new FormData()
  const buf = fs.readFileSync(filePath)
  form.append('file', new Blob([buf], { type: 'audio/wav' }), path.basename(filePath))
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  if (language) form.append('language', language)
  if (withWords) {
    form.append('timestamp_granularities[]', 'segment')
    form.append('timestamp_granularities[]', 'word')
  }

  const timeout = AbortSignal.timeout(15 * 60 * 1000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: combined
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* не JSON */
  }
  return { status: res.status, json, text }
}

interface ApiResponse {
  text?: string
  language?: string
  duration?: number
  segments?: Array<{
    start?: number
    end?: number
    text?: string
    words?: Array<{ start?: number; end?: number; word?: string; text?: string }>
  }>
  words?: Array<{ start?: number; end?: number; word?: string; text?: string }>
}

async function transcribeChunkApi(
  cfg: SttSettings,
  filePath: string,
  signal?: AbortSignal
): Promise<{ segments: TranscriptSegment[]; language?: string; note?: string }> {
  let res = await postTranscription(
    cfg.baseUrl,
    cfg.apiKey,
    cfg.model,
    cfg.language,
    filePath,
    true,
    signal
  )

  if (res.status === 400 && /timestamp_granularities|word|unknown|invalid/i.test(res.text)) {
    res = await postTranscription(
      cfg.baseUrl,
      cfg.apiKey,
      cfg.model,
      cfg.language,
      filePath,
      false,
      signal
    )
  }

  if (res.status < 200 || res.status >= 300) {
    let message = res.text.slice(0, 400)
    try {
      const parsed = res.json as { error?: { message?: string } }
      if (parsed?.error?.message) message = parsed.error.message
    } catch {
      /* ignore */
    }
    throw new Error(`STT API (${res.status}): ${message}`)
  }

  const data = (res.json ?? {}) as ApiResponse
  if (!data.segments?.length) {
    const text = (data.text || '').trim()
    if (!text) return { segments: [], language: data.language }
    // API не повернув таймкоди — рівномірно розкладаємо речення
    const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean)
    const total = Math.max(1, Number(data.duration) || sentences.length * 3)
    const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1
    let cursor = 0
    const segments: TranscriptSegment[] = sentences.map((s, i) => {
      const dur = (s.length / totalChars) * total
      const seg = { id: i, start: round(cursor), end: round(cursor + dur), text: s.trim() }
      cursor += dur
      return seg
    })
    return {
      segments,
      language: data.language,
      note: 'Провайдер не повернув сегменти — таймкоди наближені'
    }
  }

  const allWords: TranscriptWord[] = (data.words ?? []).map((w) => ({
    start: Number(w.start) || 0,
    end: Number(w.end) || 0,
    text: (w.word ?? w.text ?? '').trim()
  }))

  const raw = data.segments.map((s) => {
    const segWords = (s.words ?? []).map((w) => ({
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
      text: (w.word ?? w.text ?? '').trim()
    }))
    const words =
      segWords.length > 0
        ? segWords
        : allWords.length
          ? allWords.filter(
              (w) => w.start >= (Number(s.start) || 0) - 0.35 && w.end <= (Number(s.end) || 0) + 0.35
            )
          : undefined
    return {
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: (s.text || '').trim(),
      words
    }
  })

  return { segments: normalizeSegments(raw), language: data.language }
}

async function transcribeLocal(
  cfg: SttSettings,
  audioPath: string,
  workDir: string,
  log: (line: string) => void,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<TranscribeResult> {
  if (!fileExists(cfg.binaryPath)) {
    throw new Error('Вкажіть шлях до whisper-cli.exe у Налаштуваннях → Транскрипція')
  }
  if (!fileExists(cfg.modelPath)) {
    throw new Error('Вкажіть шлях до моделі Whisper (.bin) у Налаштуваннях')
  }
  const outBase = path.join(workDir, 'whisper_out')
  const args = [
    '-m',
    cfg.modelPath,
    '-f',
    audioPath,
    '-oj',
    '-of',
    outBase,
    '-l',
    cfg.language || 'auto',
    '--print-progress'
  ]
  log('Запускаю локальний Whisper…')
  const res = await run(cfg.binaryPath, args, {
    cwd: workDir,
    signal,
    onStderr: (line) => {
      const m = /progress\s*=\s*(\d+)%/i.exec(line)
      if (m) onProgress(Number(m[1]))
      if (/error/i.test(line)) log(line)
    },
    timeoutMs: 4 * 60 * 60 * 1000
  })
  if (res.code !== 0) throw new Error('Whisper завершився з помилкою. Перевірте шлях до бінарника та моделі.')

  const jsonPath = `${outBase}.json`
  if (!fs.existsSync(jsonPath)) throw new Error('Whisper не створив JSON-файл транскрипції')
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
    transcription?: Array<{
      offsets?: { from: number; to: number }
      timestamps?: { from: string; to: string }
      text?: string
    }>
    segments?: Array<{ start?: number; end?: number; text?: string }>
  }

  let raw: Array<{ start: number; end: number; text: string }> = []
  if (data.transcription?.length) {
    raw = data.transcription.map((t) => ({
      start: (t.offsets?.from ?? 0) / 1000,
      end: (t.offsets?.to ?? 0) / 1000,
      text: t.text ?? ''
    }))
  } else if (data.segments?.length) {
    raw = data.segments.map((t) => ({
      start: Number(t.start) || 0,
      end: Number(t.end) || 0,
      text: t.text ?? ''
    }))
  }

  onProgress(100)
  return { segments: normalizeSegments(raw), language: cfg.language || undefined }
}

export async function splitAudio(
  audioPath: string,
  workDir: string,
  duration: number,
  log: (line: string) => void
): Promise<string[]> {
  const size = fs.statSync(audioPath).size
  if (size <= MAX_UPLOAD_BYTES) return [audioPath]

  const chunks = Math.ceil(duration / CHUNK_SECONDS)
  const files: string[] = []
  for (let i = 0; i < chunks; i++) {
    const out = path.join(workDir, `stt_chunk_${String(i).padStart(3, '0')}.wav`)
    log(`Ріжу аудіо на частини для STT: ${i + 1}/${chunks}`)
    await ffmpeg([
      '-ss',
      String(i * CHUNK_SECONDS),
      '-t',
      String(CHUNK_SECONDS),
      '-i',
      audioPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      out
    ])
    files.push(out)
  }
  return files
}

export async function transcribe(
  cfg: SttSettings,
  audioPath: string,
  audioDuration: number,
  workDir: string,
  log: (line: string) => void,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<TranscribeResult> {
  if (cfg.mode === 'off') {
    return { segments: [], note: 'Транскрипцію вимкнено — субтитри недоступні' }
  }
  if (cfg.mode === 'api' && !cfg.apiKey) {
    return {
      segments: [],
      note: 'Немає API-ключа для транскрипції — додайте його в Налаштуваннях'
    }
  }

  if (cfg.mode === 'local') {
    return transcribeLocal(cfg, audioPath, workDir, log, onProgress, signal)
  }

  const files = await splitAudio(audioPath, workDir, audioDuration, log)
  const all: TranscriptSegment[] = []
  let offset = 0
  let language: string | undefined
  let note: string | undefined

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const chunkDuration = Math.min(
      CHUNK_SECONDS,
      Math.max(1, audioDuration - i * CHUNK_SECONDS)
    )
    log(`Транскрипція ${i + 1}/${files.length}…`)
    const res = await transcribeChunkApi(cfg, file, signal)
    if (res.note) note = res.note
    language = language ?? res.language
    for (const seg of res.segments) {
      all.push({
        ...seg,
        id: all.length,
        start: round(seg.start + offset),
        end: round(seg.end + offset),
        words: seg.words?.map((w) => ({
          start: round(w.start + offset),
          end: round(w.end + offset),
          text: w.text
        }))
      })
    }
    offset += chunkDuration
    onProgress(Math.round(((i + 1) / files.length) * 100))
  }

  return { segments: all, language, note }
}

/* ── Імпорт готових субтитрів ─────────────────────────────── */

function parseTimestamp(value: string): number {
  const clean = value.replace(',', '.').trim()
  const parts = clean.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] ?? 0
}

export function parseSubtitleFile(filePath: string): TranscriptSegment[] {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  const isVtt = /^WEBVTT/i.test(content.trim())
  const blocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  const raw: Array<{ start: number; end: number; text: string }> = []
  const timeRe = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/

  for (const block of blocks) {
    const lines = block.split('\n')
    const idx = lines.findIndex((l) => timeRe.test(l))
    if (idx === -1) continue
    const match = timeRe.exec(lines[idx])
    if (!match) continue
    const text = lines
      .slice(idx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    raw.push({ start: parseTimestamp(match[1]), end: parseTimestamp(match[2]), text })
  }

  if (!raw.length && isVtt) {
    // мінімальний fallback для VTT з одним рядком
    const lineRe = /^(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/gm
    let m: RegExpExecArray | null
    while ((m = lineRe.exec(content))) {
      raw.push({ start: parseTimestamp(m[1]), end: parseTimestamp(m[2]), text: '' })
    }
  }

  return normalizeSegments(raw)
}
