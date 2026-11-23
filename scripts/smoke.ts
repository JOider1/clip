/**
 * Смоук-тест ядра без Electron:
 * генерує тестове відео, проходить probe → audio → energy → analyze → render
 * для всіх шаблонів і перевіряє розміри/тривалість результату.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ffmpeg, probe, extractAudio, extractFrame } from '../src/main/core/media'
import { computeEnergy, analyze } from '../src/main/core/analyze'
import { renderClip } from '../src/main/core/render/render'
import { DEFAULT_SETTINGS } from '../src/shared/defaults'
import type { LayoutConfig, SubtitleStyle, TranscriptSegment } from '../src/shared/types'

const OUT = path.join(process.env.TEMP || '.', 'clipforge-smoke')
const work = path.join(OUT, 'work')

async function main(): Promise<void> {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })

  console.log('▶ генерую тестове відео 40 с…')
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:sample_rate=48000',
    '-t',
    '40',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    path.join(work, 'source.mp4')
  ])

  const info = await probe(path.join(work, 'source.mp4'))
  console.log('  probe:', info)
  if (Math.abs(info.duration - 40) > 1) throw new Error('Неправильна тривалість')

  await extractAudio(path.join(work, 'source.mp4'), path.join(work, 'audio.wav'))
  await extractFrame(path.join(work, 'source.mp4'), 3, path.join(work, 'frame.jpg'))
  console.log('  audio + frame ok:', fs.statSync(path.join(work, 'audio.wav')).size, 'bytes')

  const energy = await computeEnergy(path.join(work, 'audio.wav'), work, (l) => console.log('   ', l))
  console.log('  energy points:', energy.length)
  if (!energy.length) throw new Error('Енергія не порахована')

  const transcript: TranscriptSegment[] = [
    {
      id: 0,
      start: 6,
      end: 11,
      text: 'Ого, це просто неймовірно! Дивіться, що він робить!',
      words: [
        { start: 6, end: 6.4, text: 'Ого,' },
        { start: 6.5, end: 6.9, text: 'це' },
        { start: 7, end: 7.5, text: 'просто' },
        { start: 7.6, end: 8.2, text: 'неймовірно!' },
        { start: 8.4, end: 8.9, text: 'Дивіться,' },
        { start: 9, end: 9.4, text: 'що' },
        { start: 9.5, end: 9.9, text: 'він' },
        { start: 10, end: 10.8, text: 'робить!' }
      ]
    },
    {
      id: 1,
      start: 18,
      end: 24,
      text: 'Та це ж клатч року, я не можу повірити своїм очам!',
      words: [
        { start: 18, end: 18.4, text: 'Та' },
        { start: 18.4, end: 18.8, text: 'це' },
        { start: 18.8, end: 19.2, text: 'ж' },
        { start: 19.2, end: 19.9, text: 'клатч' },
        { start: 20, end: 20.5, text: 'року,' },
        { start: 21, end: 21.4, text: 'я' },
        { start: 21.5, end: 21.9, text: 'не' },
        { start: 22, end: 22.5, text: 'можу' },
        { start: 22.5, end: 23.2, text: 'повірити' },
        { start: 23.3, end: 24, text: 'очам!' }
      ]
    }
  ]

  const result = await analyze({
    title: 'Smoke test',
    duration: info.duration,
    platform: 'twitch',
    transcript,
    energy,
    settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, enabled: false } },
    count: 4,
    minDuration: 12,
    maxDuration: 30,
    log: (l) => console.log('   ', l),
    onProgress: () => undefined
  })
  console.log('  moments:', result.moments.map((m) => `${m.start}-${m.end} (${m.score})`))
  if (!result.moments.length) throw new Error('Моменти не знайдені')

  const layouts: LayoutConfig[] = [
    { id: 'face-top', faceRect: { x: 0.68, y: 0.62, w: 0.3, h: 0.36 }, gameRect: null },
    { id: 'face-bottom', faceRect: { x: 0.68, y: 0.62, w: 0.3, h: 0.36 }, gameRect: null },
    { id: 'pip', faceRect: { x: 0.68, y: 0.62, w: 0.3, h: 0.36 }, gameRect: null },
    { id: 'clean-vertical', faceRect: null, gameRect: null },
    { id: 'horizontal', faceRect: null, gameRect: null }
  ]
  const subtitle: SubtitleStyle = {
    preset: 'karaoke',
    fontFamily: 'Arial Black',
    fontSize: 72,
    uppercase: true,
    accent: '#C6FF3D',
    position: 'bottom',
    maxWords: 4
  }

  for (const layout of layouts) {
    const out = path.join(OUT, `clip-${layout.id}.mp4`)
    console.log(`▶ рендер ${layout.id}…`)
    const rendered = await renderClip({
      sourcePath: path.join(work, 'source.mp4'),
      workDir: work,
      clipStart: 6,
      clipEnd: 24,
      layout,
      subtitle,
      burnSubtitles: true,
      transcript,
      outPath: out,
      log: (l) => console.log('   ', l),
      onProgress: () => undefined
    })
    const clipInfo = await probe(out)
    const size = fs.statSync(out).size
    console.log(`   → ${rendered.width}×${rendered.height}, ${clipInfo.duration.toFixed(1)} с, ${(size / 1024).toFixed(0)} КБ`)
    const expected = layout.id === 'horizontal' ? [1920, 1080] : [1080, 1920]
    if (rendered.width !== expected[0] || rendered.height !== expected[1]) {
      throw new Error(`Неправильний розмір для ${layout.id}`)
    }
    if (clipInfo.duration < 15 || clipInfo.duration > 20) throw new Error('Неправильна тривалість кліпу')
    if (size < 20_000) throw new Error('Файл підозріло малий')
    if (!rendered.thumbPath || !fs.existsSync(rendered.thumbPath)) throw new Error('Немає прев\'ю')
  }

  fs.writeFileSync(
    path.join(OUT, 'result.txt'),
    `OK ${new Date().toISOString()}\nМоментів: ${result.moments.length}\nШаблонів: ${layouts.length}\n`
  )
  console.log('\n✅ SMOKE OK — результати в', OUT)
}

main().catch((err) => {
  console.error('\n❌ SMOKE FAILED:', err)
  process.exit(1)
})
