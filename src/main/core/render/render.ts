import fs from 'node:fs'
import path from 'node:path'
import type { LayoutConfig, Rect, SubtitleStyle, TranscriptSegment } from '../../../shared/types'
import { ffmpeg, extractFrame, safeName } from '../media'
import { writeAss } from './ass'

export interface RenderInput {
  sourcePath: string
  workDir: string
  clipStart: number
  clipEnd: number
  layout: LayoutConfig
  subtitle: SubtitleStyle
  burnSubtitles: boolean
  transcript: TranscriptSegment[]
  outPath: string
  log: (line: string) => void
  onProgress: (pct: number) => void
  signal?: AbortSignal
}

export interface RenderOutput {
  width: number
  height: number
  duration: number
  thumbPath?: string
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function normalizeRect(rect: Rect | null): Rect | null {
  if (!rect) return null
  const x = clamp01(rect.x)
  const y = clamp01(rect.y)
  const w = Math.min(clamp01(rect.w), 1 - x)
  const h = Math.min(clamp01(rect.h), 1 - y)
  if (w < 0.04 || h < 0.04) return null
  return { x, y, w, h }
}

function cropFilter(rect: Rect | null): string {
  const r = normalizeRect(rect)
  if (!r) return ''
  return `crop=iw*${r.w.toFixed(4)}:ih*${r.h.toFixed(4)}:iw*${r.x.toFixed(4)}:ih*${r.y.toFixed(4)},`
}

export function canvasFor(layoutId: LayoutConfig['id']): { width: number; height: number } {
  return layoutId === 'horizontal' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }
}

/** Будує filter_complex для обраного шаблону. */
export function buildFilterGraph(
  layout: LayoutConfig,
  subtitle: SubtitleStyle,
  burnSubtitles: boolean,
  withAudio: boolean,
  width: number,
  height: number
): string {
  const face = normalizeRect(layout.faceRect)
  const game = layout.gameRect
  const parts: string[] = []

  const gameCrop = cropFilter(game)

  if (layout.id === 'face-top' || layout.id === 'face-bottom') {
    const faceHeight = height === 1920 ? 640 : 400
    const gameHeight = height - faceHeight

    if (!face) {
      // без вебки — той самий вертикальний блюр-фон
      parts.push(
        `[0:v]split=2[bg][fg];`,
        `[bg]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=28:2,eq=brightness=-0.18[bg2];`,
        `[fg]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=decrease[fg2];`,
        `[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1[base];`
      )
    } else {
      const faceCrop = cropFilter(face)
      parts.push(
        `[0:v]split=2[gsrc][fsrc];`,
        `[fsrc]${faceCrop}split=2[fb][ff];`,
        `[fb]scale=${width}:${faceHeight}:force_original_aspect_ratio=increase,crop=${width}:${faceHeight},boxblur=20:2,eq=brightness=-0.14[fb2];`,
        `[ff]scale=${width}:${faceHeight}:force_original_aspect_ratio=decrease[ff2];`,
        `[fb2][ff2]overlay=(W-w)/2:(H-h)/2,setsar=1[face];`,
        `[gsrc]${gameCrop}scale=${width}:${gameHeight}:force_original_aspect_ratio=increase,crop=${width}:${gameHeight},setsar=1[game];`
      )
      if (layout.id === 'face-top') {
        parts.push(`[face][game]vstack=inputs=2[base];`)
      } else {
        parts.push(`[game][face]vstack=inputs=2[base];`)
      }
    }
  } else if (layout.id === 'pip') {
    if (!face) {
      parts.push(
        `[0:v]split=2[bg][fg];`,
        `[bg]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=28:2,eq=brightness=-0.18[bg2];`,
        `[fg]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=decrease[fg2];`,
        `[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1[base];`
      )
    } else {
      const faceCrop = cropFilter(face)
      const pipWidth = Math.round(width * 0.33)
      parts.push(
        `[0:v]split=2[gsrc][fsrc];`,
        `[gsrc]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[main];`,
        `[fsrc]${faceCrop}scale=${pipWidth}:-2,pad=iw+12:ih+12:6:6:color=0xFFFFFF,setsar=1[face];`,
        `[main][face]overlay=W-w-46:H-h-230[base];`
      )
    }
  } else if (layout.id === 'horizontal') {
    parts.push(
      `[0:v]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[base];`
    )
  } else {
    // clean-vertical
    parts.push(
      `[0:v]split=2[bg][fg];`,
      `[bg]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=28:2,eq=brightness=-0.18[bg2];`,
      `[fg]${gameCrop}scale=${width}:${height}:force_original_aspect_ratio=decrease[fg2];`,
      `[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1[base];`
    )
  }

  if (burnSubtitles) {
    parts.push(`[base]subtitles=filename=subs.ass[vout];`)
  } else {
    parts.push(`[base]null[vout];`)
  }

  if (withAudio) {
    parts.push(`[0:a:0]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout];`)
  }

  return parts.join('\n')
}

function parseProgress(line: string, duration: number): number | null {
  const us = /^out_time_us=(\d+)/.exec(line) ?? /^out_time_ms=(\d+)/.exec(line)
  if (us) {
    const seconds = Number(us[1]) / 1_000_000
    return Math.min(99, (seconds / duration) * 100)
  }
  if (/^progress=end/.test(line)) return 100
  return null
}

export async function renderClip(input: RenderInput): Promise<RenderOutput> {
  const { width, height } = canvasFor(input.layout.id)
  const duration = Math.max(1, input.clipEnd - input.clipStart)
  const subsPath = path.join(input.workDir, 'subs.ass')
  const filterPath = path.join(input.workDir, 'filter.txt')

  const cueCount = writeAss(subsPath, {
    segments: input.transcript,
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    style: input.subtitle,
    width,
    height
  })
  if (input.burnSubtitles) {
    input.log(cueCount ? `Субтитри: ${cueCount} реплік` : 'Субтитри: немає транскрипту для цього відрізка')
  }

  const graph = buildFilterGraph(
    input.layout,
    input.subtitle,
    input.burnSubtitles,
    true,
    width,
    height
  )
  fs.writeFileSync(filterPath, `${graph}\n`, 'utf8')
  fs.mkdirSync(path.dirname(input.outPath), { recursive: true })

  await ffmpeg(
    [
      '-ss',
      input.clipStart.toFixed(3),
      '-t',
      duration.toFixed(3),
      '-i',
      input.sourcePath,
      '-filter_complex_script',
      'filter.txt',
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      '-shortest',
      '-progress',
      'pipe:1',
      '-nostats',
      input.outPath
    ],
    {
      cwd: input.workDir,
      signal: input.signal,
      onStdout: (line) => {
        const pct = parseProgress(line, duration)
        if (pct !== null) input.onProgress(pct)
      },
      onStderr: (line) => {
        if (/error|invalid|failed/i.test(line)) input.log(line)
      },
      timeoutMs: 60 * 60 * 1000
    }
  )

  const thumbPath = path.join(input.workDir, `${safeName(path.basename(input.outPath, path.extname(input.outPath)))}.jpg`)
  let thumb: string | undefined
  try {
    await extractFrame(input.outPath, Math.min(1.2, duration / 3), thumbPath)
    thumb = thumbPath
  } catch {
    thumb = undefined
  }

  return { width, height, duration, thumbPath: thumb }
}

/** Рендер одного кадру для живого прев'ю шаблону. */
export async function renderPreviewFrame(input: {
  sourcePath: string
  workDir: string
  time: number
  layout: LayoutConfig
  subtitle: SubtitleStyle
  burnSubtitles: boolean
  transcript: TranscriptSegment[]
  outPath: string
  signal?: AbortSignal
}): Promise<string> {
  const { width, height } = canvasFor(input.layout.id)
  writeAss(path.join(input.workDir, 'subs.ass'), {
    segments: input.transcript,
    clipStart: input.time,
    clipEnd: input.time + 12,
    style: input.subtitle,
    width,
    height
  })
  const graph = buildFilterGraph(input.layout, input.subtitle, input.burnSubtitles, false, width, height)
  fs.writeFileSync(path.join(input.workDir, 'filter_preview.txt'), `${graph}\n`, 'utf8')
  fs.mkdirSync(path.dirname(input.outPath), { recursive: true })

  await ffmpeg(
    [
      '-ss',
      Math.max(0, input.time).toFixed(3),
      '-i',
      input.sourcePath,
      '-filter_complex_script',
      'filter_preview.txt',
      '-map',
      '[vout]',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      input.outPath
    ],
    { cwd: input.workDir, signal: input.signal }
  )
  return input.outPath
}
