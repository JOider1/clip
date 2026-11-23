import fs from 'node:fs'
import path from 'node:path'
import type { Moment, Settings, TranscriptSegment } from '../../shared/types'
import { ffmpeg } from './media'

export interface EnergyPoint {
  t: number
  rms: number
}

export interface Candidate {
  start: number
  end: number
  text: string
  energyZ: number
}

export interface AnalyzeResult {
  moments: Moment[]
  usedAi: boolean
  note?: string
}

const KEYWORDS: Array<{ re: RegExp; weight: number }> = [
  { re: /(wow|omg|oh my god|no way|holy|insane|crazy|unbelievable|clutch|let'?s go|nice|gg|ez|bruh|lmao|what the)/gi, weight: 1 },
  { re: /(ого+|вау|нічого собі|та ладно|да ладно|серйозно|серьезно|жесть|капець|піздець|пиздец|офіг|офиг|неймовірно|шалено|круто|топ|база|імба|имба|клатч|клатч|вайп|ейс|ace|нуб)/gi, weight: 1.2 }
]

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return 1
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) || 1
}

/** Читає середньоквадратичну гучність по секундах через ffmpeg astats. */
export async function computeEnergy(
  audioPath: string,
  workDir: string,
  log: (line: string) => void,
  signal?: AbortSignal
): Promise<EnergyPoint[]> {
  const statsFile = path.join(workDir, 'energy.txt')
  try {
    if (fs.existsSync(statsFile)) fs.unlinkSync(statsFile)
    await ffmpeg(
      [
        '-i',
        audioPath,
        '-af',
        'aresample=16000,asetnsamples=n=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=energy.txt',
        '-f',
        'null',
        '-'
      ],
      { cwd: workDir, signal, timeoutMs: 30 * 60 * 1000 }
    )
  } catch (err) {
    log(`Не вдалося обчислити гучність: ${(err as Error).message}`)
    return []
  }

  if (!fs.existsSync(statsFile)) return []
  const content = fs.readFileSync(statsFile, 'utf8')
  const points: EnergyPoint[] = []
  const re = /pts_time:([\d.]+)[\s\S]*?RMS_level=(-?[\d.]+|-inf)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    const t = Number(match[1])
    const rms = match[2] === '-inf' ? -90 : Number(match[2])
    if (Number.isFinite(t) && Number.isFinite(rms)) points.push({ t, rms })
  }
  return points
}

function energyAt(points: EnergyPoint[], start: number, end: number): number {
  if (!points.length) return 0
  const values = points.filter((p) => p.t >= start && p.t <= end).map((p) => p.rms)
  if (!values.length) return 0
  const all = points.map((p) => p.rms)
  const med = median(all)
  const sd = stdDev(all, all.reduce((a, b) => a + b, 0) / all.length)
  const max = Math.max(...values)
  return clamp((max - med) / sd, 0, 6)
}

function overlapping(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const inter = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
  const minLen = Math.min(aEnd - aStart, bEnd - bStart) || 1
  return inter / minLen
}

function sentenceHook(text: string, maxWords = 6): string {
  const words = text.replace(/[«»"“”]/g, '').split(/\s+/).filter(Boolean)
  const hook = words.slice(0, maxWords).join(' ')
  return hook.length > 46 ? `${hook.slice(0, 44).trim()}…` : hook
}

function shortTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Емоційний момент'
  const words = clean.split(' ')
  const title = words.slice(0, 9).join(' ')
  return title.length > 58 ? `${title.slice(0, 56).trim()}…` : title
}

function buildTranscriptCandidates(
  segments: TranscriptSegment[],
  minDuration: number,
  maxDuration: number,
  energy: EnergyPoint[]
): Candidate[] {
  if (!segments.length) return []
  const out: Candidate[] = []
  let i = 0
  while (i < segments.length) {
    const start = segments[i].start
    if (start > segments[segments.length - 1].end) break
    let j = i
    while (j + 1 < segments.length && segments[j + 1].end - start <= maxDuration) j++
    if (segments[j].end - start < minDuration && i > 0) {
      i += 1
      continue
    }

    // шукаємо кінець на межі речення
    let endIdx = j
    for (let k = j; k > i; k--) {
      if (segments[k].end - start < minDuration) break
      if (/[.!?…]$/.test(segments[k].text.trim())) {
        endIdx = k
        break
      }
    }
    let end = Math.min(segments[endIdx].end, start + maxDuration)
    if (end - start < minDuration) end = Math.min(start + minDuration, segments[segments.length - 1].end)
    if (end - start < 5) break

    const text = segments
      .slice(i, endIdx + 1)
      .map((s) => s.text)
      .join(' ')
      .trim()
    out.push({ start, end, text, energyZ: energyAt(energy, start, end) })

    i = Math.max(i + 1, endIdx - 1)
    if (out.length > 400) break
  }
  return out
}

function buildEnergyCandidates(
  energy: EnergyPoint[],
  duration: number,
  minDuration: number,
  maxDuration: number
): Candidate[] {
  if (energy.length < 10) return []
  const all = energy.map((p) => p.rms)
  const med = median(all)
  const mean = all.reduce((a, b) => a + b, 0) / all.length
  const sd = stdDev(all, mean)
  const peaks = energy
    .map((p) => ({ ...p, z: (p.rms - med) / sd }))
    .filter((p) => p.z > 0.7)
    .sort((a, b) => b.z - a.z)

  const chosen: Candidate[] = []
  for (const peak of peaks) {
    if (chosen.length >= 24) break
    const len = clamp(22, minDuration, maxDuration)
    const start = clamp(peak.t - len / 2, 0, Math.max(0, duration - len))
    const end = Math.min(duration, start + len)
    if (end - start < 8) continue
    if (chosen.some((c) => overlapping(c.start, c.end, start, end) > 0.35)) continue
    chosen.push({
      start,
      end,
      text: '',
      energyZ: clamp(peak.z, 0, 6)
    })
  }
  return chosen
}

function keywordHits(text: string): number {
  let hits = 0
  for (const k of KEYWORDS) {
    k.re.lastIndex = 0
    const matches = text.match(k.re)
    if (matches) hits += matches.length * k.weight
  }
  return hits
}

interface ScoredCandidate extends Candidate {
  score: number
  reason: string
}

export function scoreHeuristically(candidates: Candidate[]): ScoredCandidate[] {
  return candidates.map((c) => {
    const hits = keywordHits(c.text)
    const exclamations = (c.text.match(/[!?]/g) ?? []).length
    const keywordScore = Math.min(42, hits * 9)
    const punctScore = Math.min(14, exclamations * 3.5)
    const energyScore = Math.min(34, c.energyZ * 7)
    const base = c.text ? 12 : 8
    const score = Math.round(clamp(base + keywordScore + punctScore + energyScore, 4, 97))

    const parts: string[] = []
    if (c.energyZ >= 1.5) parts.push('сплеск гучності / емоцій')
    if (hits >= 1) parts.push('тригерні слова')
    if (exclamations >= 2) parts.push('висока експресія')
    if (!parts.length) parts.push('рівний темп, можна скоротити')
    return {
      ...c,
      score,
      reason: `Евристика: ${parts.join(', ')}`
    }
  })
}

export function dedupe<T extends { start: number; end: number; score: number }>(
  scored: T[],
  limit: number
): T[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  const accepted: T[] = []
  for (const item of sorted) {
    if (accepted.length >= limit) break
    if (accepted.some((a) => overlapping(a.start, a.end, item.start, item.end) > 0.45)) continue
    accepted.push(item)
  }
  return accepted.sort((a, b) => b.score - a.score)
}

function toMoments(
  items: Array<{
    start: number
    end: number
    score: number
    title?: string
    hook?: string
    reason?: string
    tags?: string[]
  }>,
  source: 'ai' | 'heuristic'
): Moment[] {
  return items.map((m, index) => ({
    id: `${source}-${Date.now().toString(36)}-${index}`,
    start: Math.round(m.start * 100) / 100,
    end: Math.round(m.end * 100) / 100,
    score: Math.round(clamp(m.score, 0, 100)),
    title: (m.title || 'Момент').trim(),
    hook: (m.hook || '').trim(),
    reason: (m.reason || '').trim(),
    tags: (m.tags ?? []).filter(Boolean).slice(0, 5),
    source,
    selected: index < 6
  }))
}

/* ── AI ───────────────────────────────────────────────────── */

interface AiMoment {
  start?: number
  end?: number
  score?: number
  title?: string
  hook?: string
  reason?: string
  tags?: string[]
}

async function askAi(
  settings: Settings,
  meta: { title: string; duration: number; platform: string; language?: string },
  candidates: ScoredCandidate[],
  peaks: EnergyPoint[],
  count: number,
  minDuration: number,
  maxDuration: number,
  log: (line: string) => void,
  signal?: AbortSignal
): Promise<AiMoment[]> {
  const cfg = settings.ai
  const lines = candidates.slice(0, 90).map((c, i) => {
    const stamp = `${c.start.toFixed(1)}–${c.end.toFixed(1)}`
    return `${i + 1}. [${stamp}]${c.energyZ >= 1.5 ? ' (гучно)' : ''} ${c.text.slice(0, 400) || '(без мовлення)'}`
  })

  const peakTimes = peaks
    .slice()
    .sort((a, b) => b.rms - a.rms)
    .slice(0, 12)
    .map((p) => p.t.toFixed(0))
    .join(', ')

  const system = `Ти — досвідчений редактор вірусних кліпів для TikTok, YouTube Shorts та Reels.
Обираєш моменти зі стрімів, які мають найбільший потенціал переглядів і лайків: яскраві емоції, смішні реакції, несподівані повороти, клатчі, конфлікти, сильні фрази-гачки.
Повертай ВИКЛЮЧНО валідний JSON без markdown. Пиши українською.
Схема: {"moments":[{"start":число,"end":число,"score":0-100,"title":"короткий заголовок","hook":"перші 3-6 слів для оверлею","reason":"чому зайде","tags":["тег"]}]}
Довжина кожного кліпу від ${minDuration} до ${maxDuration} секунд. Не вигадуй таймкоди поза межами відео. Не дублюй моменти.`

  const user = `Відео: "${meta.title}" (${meta.platform}), тривалість ${meta.duration.toFixed(0)} с.
Мова стріму: ${meta.language || 'невідома'}.
Піки гучності (секунди): ${peakTimes || 'немає даних'}.

Кандидатні відрізки (таймкоди в секундах):
${lines.join('\n')}

Обери до ${count} найкращих моментів. Для кожного дай оцінку вірусності 0–100, заголовок, hook, причину та 1–3 теги.`

  const endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body = {
    model: cfg.model,
    temperature: cfg.temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    response_format: { type: 'json_object' }
  }

  const timeout = AbortSignal.timeout(180_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  const call = async (withFormat: boolean): Promise<{ status: number; text: string }> => {
    const payload = { ...body }
    if (!withFormat) delete (payload as { response_format?: unknown }).response_format
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
      },
      body: JSON.stringify(payload),
      signal: combined
    })
    return { status: res.status, text: await res.text() }
  }

  let res = await call(true)
  if (res.status === 400 && /response_format|json_object|unsupported/i.test(res.text)) {
    res = await call(false)
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`AI API (${res.status}): ${res.text.slice(0, 300)}`)
  }

  let content = ''
  try {
    const parsed = JSON.parse(res.text) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    }
    const raw = parsed.choices?.[0]?.message?.content
    content = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? '').join('') : ''
  } catch {
    throw new Error('AI повернув некоректну відповідь')
  }

  const jsonText = content.replace(/```(?:json)?/gi, '').trim()
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI не повернув JSON')
  const data = JSON.parse(jsonText.slice(start, end + 1)) as { moments?: AiMoment[] }
  if (!Array.isArray(data.moments)) throw new Error('AI не повернув список моментів')
  log(`AI запропонував ${data.moments.length} моментів`)
  return data.moments
}

/* ── Головна функція ──────────────────────────────────────── */

export interface AnalyzeInput {
  title: string
  duration: number
  platform: string
  transcript: TranscriptSegment[]
  energy: EnergyPoint[]
  settings: Settings
  count: number
  minDuration: number
  maxDuration: number
  log: (line: string) => void
  onProgress: (pct: number) => void
  signal?: AbortSignal
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  const { transcript, energy, settings, minDuration, maxDuration, count, log, onProgress } = input
  const total = Math.max(count * 3, 12)

  const transcriptCandidates = buildTranscriptCandidates(transcript, minDuration, maxDuration, energy)
  const energyCandidates = buildEnergyCandidates(energy, input.duration, minDuration, maxDuration)

  const merged: Candidate[] = [...transcriptCandidates, ...energyCandidates]
  log(`Кандидатів: ${transcriptCandidates.length} з транскрипту, ${energyCandidates.length} за гучністю`)

  if (!merged.length) {
    const len = clamp(20, minDuration, maxDuration)
    const fallback: Candidate[] = []
    for (let i = 0; i < Math.min(count, 6); i++) {
      const start = clamp((input.duration / Math.max(1, count)) * i, 0, Math.max(0, input.duration - len))
      fallback.push({ start, end: Math.min(input.duration, start + len), text: '', energyZ: 0 })
    }
    const scored = scoreHeuristically(fallback)
    return {
      moments: toMoments(
        scored.map((s) => ({
          ...s,
          title: `Момент ${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, '0')}`,
          hook: '',
          reason: 'Автоматична нарізка рівними частинами'
        })),
        'heuristic'
      ),
      usedAi: false,
      note: 'Недостатньо даних для розумного відбору — нарізано рівномірно'
    }
  }

  const scored = scoreHeuristically(merged)
  onProgress(35)

  let aiMoments: AiMoment[] = []
  let usedAi = false
  let note: string | undefined

  if (settings.ai.enabled && settings.ai.apiKey && settings.ai.model) {
    try {
      log(`Запит до AI (${settings.ai.model})…`)
      aiMoments = await askAi(
        settings,
        {
          title: input.title,
          duration: input.duration,
          platform: input.platform,
          language: settings.stt.language
        },
        scored,
        energy,
        total,
        minDuration,
        maxDuration,
        log,
        input.signal
      )
      usedAi = true
    } catch (err) {
      note = `AI недоступний: ${(err as Error).message}`
      log(note)
    }
  } else {
    log('AI-відбір вимкнено — працює евристика (гучність + ключові слова)')
  }
  onProgress(80)

  let candidates: Array<{
    start: number
    end: number
    score: number
    title: string
    hook: string
    reason: string
    tags: string[]
  }>

  if (usedAi && aiMoments.length) {
    const valid = aiMoments
      .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end))
      .map((m) => {
        const start = clamp(Number(m.start), 0, Math.max(0, input.duration - 3))
        const end = clamp(Number(m.end), start + 3, input.duration)
        const dur = end - start
        const fixedEnd = dur > maxDuration ? start + maxDuration : dur < Math.min(8, minDuration) ? Math.min(input.duration, start + minDuration) : end
        const nearest = scored.find((s) => overlapping(s.start, s.end, start, fixedEnd) > 0.25)
        const heur = nearest?.score ?? 45
        const aiScore = Number(m.score) || 60
        return {
          start,
          end: fixedEnd,
          score: Math.round(clamp(aiScore * 0.82 + heur * 0.18, 1, 100)),
          title: (m.title || shortTitle(nearest?.text || '')).slice(0, 90),
          hook: (m.hook || sentenceHook(nearest?.text || '')).slice(0, 90),
          reason: m.reason || 'Сильна емоція та динаміка',
          tags: Array.isArray(m.tags) ? m.tags.slice(0, 4) : []
        }
      })
      .filter((m) => m.end - m.start >= 5)

    const deduped = dedupe(
      valid.map((v) => ({ ...v, text: '', energyZ: 0, reason: v.reason })),
      count
    )
    candidates = deduped.map((d) => ({
      start: d.start,
      end: d.end,
      score: d.score,
      title: d.title ?? 'Момент',
      hook: d.hook ?? '',
      reason: d.reason,
      tags: d.tags ?? []
    }))
  } else {
    const best = dedupe(
      scored.map((s) => ({
        ...s,
        title: shortTitle(s.text),
        hook: sentenceHook(s.text),
        reason: s.reason
      })),
      count
    )
    candidates = best.map((b) => ({
      start: b.start,
      end: b.end,
      score: b.score,
      title: b.title ?? shortTitle(b.text),
      hook: b.hook ?? sentenceHook(b.text),
      reason: b.reason,
      tags: []
    }))
  }

  if (!candidates.length) {
    candidates = scoreHeuristically(merged)
      .slice(0, count)
      .map((c) => ({
        start: c.start,
        end: c.end,
        score: c.score,
        title: shortTitle(c.text),
        hook: sentenceHook(c.text),
        reason: c.reason,
        tags: []
      }))
  }

  onProgress(100)
  return { moments: toMoments(candidates, usedAi ? 'ai' : 'heuristic'), usedAi, note }
}
