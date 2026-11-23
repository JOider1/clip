import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { MediaInfo } from '../../shared/types'

/** У пакунку бінарники лежать поруч з asar-архівом. */
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

let ffmpegCache: string | null = null
let ffprobeCache: string | null = null

export function ffmpegBin(): string {
  if (ffmpegCache) return ffmpegCache
  const fromEnv = process.env.CLIPFORGE_FFMPEG
  const candidate = fromEnv || (ffmpegStatic ? unpacked(ffmpegStatic as unknown as string) : 'ffmpeg')
  ffmpegCache = candidate
  return candidate
}

export function ffprobeBin(): string {
  if (ffprobeCache) return ffprobeCache
  const fromEnv = process.env.CLIPFORGE_FFPROBE
  const candidate = fromEnv || unpacked(ffprobeStatic.path)
  ffprobeCache = candidate
  return candidate
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  cwd?: string
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
  signal?: AbortSignal
  timeoutMs?: number
}

const MAX_CAPTURE = 8 * 1024 * 1024

export function run(bin: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })

    let stdout = ''
    let stderr = ''
    let stdoutBuf = ''
    let stderrBuf = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const handleLine = (line: string, stream: 'out' | 'err'): void => {
      if (!line.trim()) return
      if (stream === 'out') options.onStdout?.(line)
      else options.onStderr?.(line)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stdout.length < MAX_CAPTURE) stdout += text
      stdoutBuf += text
      const lines = stdoutBuf.split(/\r?\n|\r/)
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) handleLine(line, 'out')
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stderr.length < MAX_CAPTURE) stderr += text
      stderrBuf += text
      const lines = stderrBuf.split(/\r?\n|\r/)
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) handleLine(line, 'err')
    })

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }

    const onAbort = (): void => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish(() => reject(new Error('Скасовано')))
    }

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort()
        return
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        finish(() => reject(new Error('Перевищено час очікування')))
      }, options.timeoutMs)
    }

    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => {
      if (stdoutBuf) handleLine(stdoutBuf, 'out')
      if (stderrBuf) handleLine(stderrBuf, 'err')
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      finish(() => resolve({ code: code ?? -1, stdout, stderr }))
    })
  })
}

export async function ffmpeg(args: string[], options: RunOptions = {}): Promise<RunResult> {
  const result = await run(ffmpegBin(), ['-hide_banner', '-y', ...args], options)
  if (result.code !== 0) {
    const tail = result.stderr.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')
    throw new Error(`ffmpeg завершився з кодом ${result.code}${tail ? `\n${tail}` : ''}`)
  }
  return result
}

export function which(bin: string): string | null {
  try {
    const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (res.status !== 0) return null
    return res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null
  } catch {
    return null
  }
}

export async function probe(file: string): Promise<MediaInfo> {
  const res = await run(ffprobeBin(), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file
  ])
  if (res.code !== 0) throw new Error('Не вдалося прочитати відеофайл')
  const data = JSON.parse(res.stdout) as {
    format?: { duration?: string }
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      r_frame_rate?: string
      duration?: string
    }>
  }
  const video = data.streams?.find((s) => s.codec_type === 'video')
  const audio = data.streams?.find((s) => s.codec_type === 'audio')
  if (!video) throw new Error('У файлі немає відеодоріжки')
  if (!audio) throw new Error('У файлі немає аудіодоріжки')

  const duration = Number(data.format?.duration ?? video.duration ?? 0)
  const fpsRaw = video.avg_frame_rate || video.r_frame_rate || '30/1'
  const [num, den] = fpsRaw.split('/').map(Number)
  const fps = den ? num / den : 30

  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30
  }
}

export async function extractAudio(
  videoPath: string,
  outPath: string,
  options: RunOptions = {}
): Promise<void> {
  await ffmpeg(
    ['-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outPath],
    options
  )
}

export async function extractFrame(
  videoPath: string,
  time: number,
  outPath: string,
  options: RunOptions = {}
): Promise<void> {
  await ffmpeg(
    [
      '-ss',
      Math.max(0, time).toFixed(3),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '3',
      outPath
    ],
    options
  )
}

export function fileExists(p?: string | null): boolean {
  if (!p) return false
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`
}

export function safeName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'clip'
  )
}

export function shortPath(p: string, max = 60): string {
  if (p.length <= max) return p
  const parts = p.split(path.sep)
  return `…${path.sep}${parts.slice(-2).join(path.sep)}`
}
