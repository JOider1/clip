import fs from 'node:fs'
import type { SubtitleStyle, TranscriptSegment, TranscriptWord } from '../../../shared/types'

interface Cue {
  start: number
  end: number
  text: string
  words?: TranscriptWord[]
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function assTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const cs = Math.floor((total - Math.floor(total)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function assEscape(text: string): string {
  return text
    .replace(/\\/g, '/')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hexToAss(hex: string): string {
  const clean = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '&H00FFFFFF'
  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}

function splitWordsByLength(words: TranscriptWord[], maxWords: number, maxChars: number): TranscriptWord[][] {
  const groups: TranscriptWord[][] = []
  let current: TranscriptWord[] = []
  let chars = 0
  for (const word of words) {
    const nextChars = chars + (current.length ? 1 : 0) + word.text.length
    const endsSentence = /[.!?…,;]$/.test(word.text)
    if (current.length && (current.length >= maxWords || nextChars > maxChars)) {
      groups.push(current)
      current = []
      chars = 0
    }
    current.push(word)
    chars += (current.length > 1 ? 1 : 0) + word.text.length
    if (current.length >= 2 && endsSentence) {
      groups.push(current)
      current = []
      chars = 0
    }
  }
  if (current.length) groups.push(current)
  return groups
}

/** Розбиває сегмент без word-timestamps на короткі кадри. */
function splitTextSegment(segment: TranscriptSegment, style: SubtitleStyle): Cue[] {
  const words = segment.text.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const maxWords = clamp(style.maxWords || 4, 2, 8)
  const groups: string[][] = []
  let current: string[] = []
  for (const word of words) {
    const nextLen = current.reduce((n, w) => n + w.length + 1, 0) + word.length
    if (current.length && (current.length >= maxWords || nextLen > 34)) {
      groups.push(current)
      current = []
    }
    current.push(word)
    if (current.length >= 2 && /[.!?…]$/.test(word)) {
      groups.push(current)
      current = []
    }
  }
  if (current.length) groups.push(current)

  const totalChars = groups.reduce((n, g) => n + g.join(' ').length, 0) || 1
  const duration = Math.max(0.4, segment.end - segment.start)
  const minDur = 0.55
  const rawDurations = groups.map((g) => Math.max(minDur, (g.join(' ').length / totalChars) * duration))
  const sum = rawDurations.reduce((a, b) => a + b, 0)
  const scale = sum > duration ? duration / sum : 1

  let cursor = segment.start
  return groups.map((g, i) => {
    // остання група добирає залишок, щоб не було дір
    const dur = i === groups.length - 1 ? Math.max(minDur, segment.end - cursor) : rawDurations[i] * scale
    const cue = { start: cursor, end: Math.min(segment.end, cursor + dur), text: g.join(' ') }
    cursor = cue.end
    return cue
  })
}

function buildCues(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  style: SubtitleStyle
): Cue[] {
  const cues: Cue[] = []
  for (const segment of segments) {
    if (segment.end <= clipStart + 0.05 || segment.start >= clipEnd - 0.05) continue
    const words = segment.words?.filter(
      (w) => w.end > clipStart + 0.02 && w.start < clipEnd - 0.02 && w.text.trim()
    )

    if (words?.length) {
      const groups = splitWordsByLength(words, clamp(style.maxWords || 4, 2, 8), 38)
      for (const group of groups) {
        if (!group.length) continue
        const start = Math.max(clipStart, group[0].start)
        const end = Math.min(clipEnd, group[group.length - 1].end + 0.12)
        if (end - start < 0.15) continue
        cues.push({
          start: start - clipStart,
          end: end - clipStart,
          text: group.map((w) => w.text).join(' '),
          words: group.map((w) => ({
            start: Math.max(0, w.start - clipStart),
            end: Math.max(0, w.end - clipStart),
            text: w.text
          }))
        })
      }
    } else {
      const clipped: TranscriptSegment = {
        id: segment.id,
        start: Math.max(segment.start, clipStart),
        end: Math.min(segment.end, clipEnd),
        text: segment.text
      }
      for (const cue of splitTextSegment(clipped, style)) {
        if (cue.end - cue.start < 0.15) continue
        cues.push({
          start: cue.start - clipStart,
          end: cue.end - clipStart,
          text: cue.text
        })
      }
    }
  }

  cues.sort((a, b) => a.start - b.start)
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start - 0.02) {
      cues[i].end = Math.max(cues[i].start + 0.2, cues[i + 1].start - 0.02)
    }
  }
  return cues.filter((c) => c.end - c.start >= 0.15)
}

export interface AssOptions {
  segments: TranscriptSegment[]
  clipStart: number
  clipEnd: number
  style: SubtitleStyle
  width: number
  height: number
}

export function buildAss(options: AssOptions): { content: string; cues: number } {
  const { segments, clipStart, clipEnd, style, width, height } = options
  const cues = buildCues(segments, clipStart, clipEnd, style)
  const vertical = height > width
  const fontSize = Math.round(vertical ? style.fontSize : style.fontSize * 0.72)
  const accent = hexToAss(style.accent)
  const karaoke = style.preset === 'karaoke'
  const primary = karaoke ? accent : '&H00FFFFFF'
  const secondary = karaoke ? '&H00FFFFFF' : accent
  const borderStyle = style.preset === 'boxed' ? 3 : 1
  const outline = style.preset === 'boxed' ? 16 : style.preset === 'minimal' ? 2.5 : 5
  const shadow = style.preset === 'boxed' ? 0 : style.preset === 'minimal' ? 1 : 2
  const backColour = '&H66000000'
  const alignment = style.position === 'top' ? 8 : style.position === 'center' ? 5 : 2
  const marginV =
    style.position === 'top' ? Math.round(height * 0.09) : style.position === 'center' ? 0 : Math.round(vertical ? 150 : 62)

  const header = `[Script Info]
Title: ClipForge captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${width}
PlayResY: ${height}
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${style.fontFamily || 'Arial'},${fontSize},${primary},${secondary},&H00000000,${backColour},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const events = cues
    .map((cue, index) => {
      const start = assTime(cue.start)
      const end = assTime(Math.max(cue.start + 0.2, cue.end))
      let text = style.uppercase ? cue.text.toUpperCase() : cue.text
      text = assEscape(text)

      if (karaoke && cue.words?.length) {
        const total = Math.max(0.2, cue.end - cue.start)
        const durations = cue.words.map((w, i) => {
          const next = cue.words![i + 1]?.start ?? cue.end
          return Math.max(4, Math.round((Math.min(next, cue.end) - w.start) * 100))
        })
        const sum = durations.reduce((a, b) => a + b, 0)
        const factor = (total * 100) / Math.max(1, sum)
        const karaokeText = cue.words
          .map((w, i) => `{\\k${Math.max(3, Math.round(durations[i] * factor))}}${assEscape(style.uppercase ? w.text.toUpperCase() : w.text)}`)
          .join(' ')
        return `Dialogue: 0,${start},${end},Cap,,0,0,0,,{\\fad(50,60)}${karaokeText}`
      }

      const intro = index === 0 ? '{\\fad(80,60)}' : '{\\fad(45,45)}'
      return `Dialogue: 0,${start},${end},Cap,,0,0,0,,${intro}${text}`
    })
    .join('\n')

  return { content: `${header}${events}\n`, cues: cues.length }
}

export function writeAss(filePath: string, options: AssOptions): number {
  const { content, cues } = buildAss(options)
  fs.writeFileSync(filePath, content, 'utf8')
  return cues
}
