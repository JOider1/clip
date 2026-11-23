import { chromium } from 'playwright-core'

const OUT = 'C:/Users/stasb/AppData/Local/Temp/clipforge-qa'
const SRC = 'C:/Users/stasb/AppData/Local/Temp/clipforge-qa/source-90s.mp4'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
let page = null
for (const ctx of browser.contexts()) {
  for (const p of ctx.pages()) {
    if (!page && !p.url().startsWith('devtools')) page = p
  }
}
if (!page) throw new Error('no page')

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const shot = async (name) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

// Прибрати попередні тестові проєкти
const stale = await page.evaluate(async () => {
  const st = await window.clipper.getState()
  const old = st.jobs.filter((j) => j.title.startsWith('source-90s'))
  for (const j of old) await window.clipper.deleteJob(j.id)
  return old.map((j) => j.id)
})
if (stale.length) console.log('removed stale jobs', stale)
await page.reload()
await page.waitForTimeout(1200)

const created = await page.evaluate(async (src) => {
  return window.clipper.createJob(
    { kind: 'file', filePath: src },
    { count: 3, minDuration: 10, maxDuration: 20, layoutId: 'face-top' }
  )
}, SRC)
console.log('created job', created.id, created.title)

let job = created
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000)
  job = await page.evaluate(async (id) => {
    const st = await window.clipper.getState()
    return st.jobs.find((j) => j.id === id)
  }, created.id)
  if (!job || job.status === 'ready' || job.status === 'error') break
}
console.log('status', job?.status, 'progress', job?.progress, 'moments', job?.moments?.length)
if (job?.error) console.log('job error:', job.error)

// Підкласти тестовий транскрипт із word timings, щоб перевірити субтитри/караоке
if (job && job.status === 'ready') {
  const words = (text, start, per) =>
    text.split(' ').map((w, i) => ({ start: start + i * per, end: start + (i + 1) * per - 0.05, text: w }))
  const transcript = [
    { id: 1, start: 6, end: 9.4, text: 'ЦЕ БУЛО НЕЙМОВІРНО', words: words('ЦЕ БУЛО НЕЙМОВІРНО', 6, 1.1) },
    {
      id: 2,
      start: 12,
      end: 16.2,
      text: 'ТАКОГО ТИ ЩЕ НЕ БАЧИВ',
      words: words('ТАКОГО ТИ ЩЕ НЕ БАЧИВ', 12, 0.9)
    },
    {
      id: 3,
      start: 30,
      end: 34.5,
      text: 'ДИВИСЬ ЩО ЗАРАЗ БУДЕ',
      words: words('ДИВИСЬ ЩО ЗАРАЗ БУДЕ', 30, 0.95)
    },
    {
      id: 4,
      start: 60,
      end: 64,
      text: 'ЦЕ ПРОСТО ВАУ',
      words: words('ЦЕ ПРОСТО ВАУ', 60, 1.05)
    }
  ]
  await page.evaluate(
    async ({ id, transcript }) => window.clipper.updateJob(id, { transcript }),
    { id: job.id, transcript }
  )
  console.log('transcript injected')
}

await page.reload()
await page.waitForTimeout(1500)

// Відкрити проєкт
const card = page.locator('.job-card').first()
if (await card.count()) {
  await card.click()
  await page.waitForTimeout(1200)
  await shot('20-job-moments')

  await page.getByRole('button', { name: /Шаблон/ }).first().click()
  await page.waitForTimeout(2500)
  await shot('21-job-layout')

  // Натиснути прев'ю, якщо є
  const previewBtn = page.getByRole('button', { name: /Прев/ }).first()
  if (await previewBtn.count()) {
    await previewBtn.click()
    await page.waitForTimeout(9000)
    await shot('22-job-layout-preview')
  }

  await page.getByRole('button', { name: /^Кліпи/ }).first().click()
  await page.waitForTimeout(700)
  await shot('23-job-clips')

  await page.getByRole('button', { name: /Транскрипт/ }).first().click()
  await page.waitForTimeout(700)
  await shot('24-job-transcript')
}

console.log('--- errors ---')
console.log(errors.length ? errors.join('\n') : '(none)')

// Прибрати тестовий проєкт
await page.evaluate(async (id) => window.clipper.deleteJob(id), created.id)
console.log('test job deleted')
await browser.close()
