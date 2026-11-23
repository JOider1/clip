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
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

const created = await page.evaluate(async (src) => {
  return window.clipper.createJob(
    { kind: 'file', filePath: src },
    { count: 2, minDuration: 10, maxDuration: 20, layoutId: 'face-top' }
  )
}, SRC)
console.log('created', created.id)

let job = created
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  job = await page.evaluate(async (id) => {
    const st = await window.clipper.getState()
    return st.jobs.find((j) => j.id === id)
  }, created.id)
  if (!job || job.status === 'ready' || job.status === 'error') break
}
console.log('status', job?.status, 'moments', job?.moments?.map((m) => `${m.title} ${m.start}-${m.end}`))

await page.reload()
await page.waitForTimeout(1500)
await page.locator('.job-card').first().click()
await page.waitForTimeout(900)
await shot('30-moments-fixed-title')

await page.getByRole('button', { name: /Шаблон/ }).first().click()
await page.waitForTimeout(2200)

// Drag the face rect
const box = page.locator('.frame-box.face, .frame-box[data-kind="face"], .layout-editor .box').first()
console.log('frame boxes:', await page.locator('.frame-box').count())
const before = await page.evaluate(() => {
  const el = document.querySelector('.frame-box')
  return el ? el.getBoundingClientRect().toJSON() : null
})
if (before) {
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 - 40, before.y + before.height / 2 - 30, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => {
    const el = document.querySelector('.frame-box')
    return el ? el.getBoundingClientRect().toJSON() : null
  })
  console.log('drag moved:', JSON.stringify({ before, after }))
}

// Preview
const previewBtn = page.getByRole('button', { name: /прев/i }).first()
console.log('preview buttons:', await previewBtn.count())
if (await previewBtn.count()) {
  await previewBtn.click()
  await page.waitForTimeout(12000)
  await shot('31-layout-preview')
}

console.log('--- errors ---')
console.log(errors.length ? errors.join('\n') : '(none)')

await page.evaluate(async (id) => window.clipper.deleteJob(id), created.id)
console.log('deleted')
await browser.close()
