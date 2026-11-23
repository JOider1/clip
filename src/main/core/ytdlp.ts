import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { ffmpegBin, ensureDir, run, which } from './media'

export interface RemoteMeta {
  title: string
  duration: number
  uploader?: string
  thumbnail?: string
}

let cachedPath: string | null = null

function exists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function downloadFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void,
  redirects = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Забагато перенаправлень при завантаженні yt-dlp'))
      return
    }
    const client = url.startsWith('https:') ? https : http
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'ClipForge/1.0',
          Accept: 'application/octet-stream'
        }
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          downloadFile(next, dest, onProgress, redirects + 1).then(resolve, reject)
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`Не вдалося завантажити yt-dlp (HTTP ${status})`))
          return
        }
        const total = Number(res.headers['content-length'] ?? 0)
        let received = 0
        const tmp = `${dest}.part`
        const out = fs.createWriteStream(tmp)
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total > 0) onProgress(Math.min(99, (received / total) * 100))
        })
        res.pipe(out)
        out.on('finish', () => {
          out.close(() => {
            try {
              fs.renameSync(tmp, dest)
              onProgress(100)
              resolve()
            } catch (err) {
              reject(err)
            }
          })
        })
        out.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(60_000, () => {
      req.destroy(new Error('Таймаут завантаження yt-dlp'))
    })
  })
}

/**
 * Гарантує наявність yt-dlp.exe: налаштований шлях → PATH → локальна тека застосунку.
 */
export async function ensureYtDlp(
  customPath: string,
  binDir: string,
  log: (line: string) => void
): Promise<string> {
  if (customPath && exists(customPath)) {
    cachedPath = customPath
    return customPath
  }
  if (cachedPath && exists(cachedPath)) return cachedPath

  const fromPath = which('yt-dlp')
  if (fromPath) {
    cachedPath = fromPath
    return fromPath
  }

  ensureDir(binDir)
  const dest = path.join(binDir, 'yt-dlp.exe')
  if (exists(dest) && fs.statSync(dest).size > 1_000_000) {
    cachedPath = dest
    return dest
  }

  log('Завантажую yt-dlp (один раз, ~20 МБ)…')
  await downloadFile(
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    dest,
    (p) => {
      if (Math.round(p) % 10 === 0) log(`yt-dlp: ${p.toFixed(0)}%`)
    }
  )
  cachedPath = dest
  log('yt-dlp готовий до роботи')
  return dest
}

export function ytDlpVersion(bin: string): string {
  try {
    const res = runSyncVersion(bin)
    return res
  } catch {
    return 'unknown'
  }
}

function runSyncVersion(bin: string): string {
  // spawnSync тут безпечний: --version відповідає миттєво
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const res = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true })
  return (res.stdout || '').trim() || 'unknown'
}

function cookieArgs(cookiesFile: string): string[] {
  return cookiesFile && exists(cookiesFile) ? ['--cookies', cookiesFile] : []
}

export async function fetchMeta(
  bin: string,
  url: string,
  cookiesFile: string,
  log: (line: string) => void
): Promise<RemoteMeta | null> {
  try {
    const res = await run(
      bin,
      [
        '-J',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout',
        '20',
        '--no-check-formats',
        ...cookieArgs(cookiesFile),
        url
      ],
      {
        timeoutMs: 90_000,
        onStderr: (line) => {
          if (/ERROR|WARNING/i.test(line)) log(line)
        }
      }
    )
    if (res.code !== 0) return null
    const jsonLine = res.stdout.split(/\r?\n/).find((l) => l.trim().startsWith('{'))
    if (!jsonLine) return null
    const data = JSON.parse(jsonLine) as {
      title?: string
      duration?: number
      uploader?: string
      thumbnail?: string
    }
    return {
      title: data.title || 'Без назви',
      duration: Number(data.duration) || 0,
      uploader: data.uploader,
      thumbnail: data.thumbnail
    }
  } catch (err) {
    log(`Метадані недоступні: ${(err as Error).message}`)
    return null
  }
}

export async function downloadVideo(
  bin: string,
  url: string,
  workDir: string,
  cookiesFile: string,
  log: (line: string) => void,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<string> {
  ensureDir(workDir)
  const progressRe = /\[download\]\s+(\d+(?:\.\d+)?)%/
  let lastLogged = -1

  const res = await run(
    bin,
    [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--progress',
      '--socket-timeout',
      '30',
      '--retries',
      '5',
      '--fragment-retries',
      '10',
      '-f',
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4',
      '--ffmpeg-location',
      path.dirname(ffmpegBin()),
      '-o',
      'source.%(ext)s',
      ...cookieArgs(cookiesFile),
      url
    ],
    {
      cwd: workDir,
      signal,
      onStdout: (line) => {
        const match = progressRe.exec(line)
        if (match) {
          const pct = Number(match[1])
          onProgress(pct)
          if (Math.floor(pct / 20) > lastLogged) {
            lastLogged = Math.floor(pct / 20)
            log(`Завантаження: ${pct.toFixed(0)}%`)
          }
        } else if (/\[Merger\]|\[ExtractAudio\]|Destination/.test(line)) {
          log(line.replace(/^\[[^\]]+\]\s*/, ''))
        }
      },
      onStderr: (line) => {
        if (/ERROR/i.test(line)) log(line)
      }
    }
  )

  if (res.code !== 0) {
    const err = res.stderr.split(/\r?\n/).filter((l) => /ERROR/i.test(l)).slice(-3).join('\n')
    throw new Error(
      `yt-dlp не зміг завантажити відео.${err ? `\n${err}` : ''}\nПеревірте посилання, приватність відео або додайте cookies у Налаштуваннях.`
    )
  }

  const files = fs
    .readdirSync(workDir)
    .filter((f) => f.startsWith('source.') && !f.endsWith('.part'))
    .map((f) => path.join(workDir, f))
    .filter((f) => fs.statSync(f).isFile())
  if (!files.length) throw new Error('yt-dlp завершився, але відеофайл не знайдено')
  files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
  return files[0]
}

export function detectSourceType(url: string): 'youtube' | 'twitch' | 'other' {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (host.includes('youtube.com') || host === 'youtu.be' || host.includes('youtube-nocookie')) {
      return 'youtube'
    }
    if (host.includes('twitch.tv')) return 'twitch'
  } catch {
    /* ignore */
  }
  return 'other'
}
