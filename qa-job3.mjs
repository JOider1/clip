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
console.log('status', job?.status)

await page.reload()
await page.waitForTimeout(1500)
await page.locator('.job-card').first().click()
await page.waitForTimeout(900)
await page.getByRole('button', { name: /Шаблон/ }).first().click()
await page.waitForTimeout(2200)

// Kalibruvannia: drag face rect
const face = page.locator('.editor-rect.face')
console.log('face rects:', await face.count())
const before = await face.boundingBox()
if (before) {
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 - 40, before.y + before.height / 2 - 30, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await face.boundingBox()
  console.log('drag:', JSON.stringify({ before, after }))
}

// Resize via handle
const handle = page.locator('.editor-rect.face .rect-handle')
const hb = await handle.boundingBox()
if (hb) {
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2 - 30, hb.y + hb.height / 2 - 20, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  console.log('resized:', JSON.stringify(await face.boundingBox()))
}

const previewBtn = page.getByRole('button', { name: /прев/i }).first()
if (await previewBtn.count()) {
  await previewBtn.click()
  await page.waitForTimeout(12000)
  const box = page.locator('.preview-box')
  await box.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await shot('32-preview-full')
  const img = await page.evaluate(() => {
    const im = document.querySelector('.preview-box img')
    if (!im) return null
    const r = im.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), natW: im.naturalWidth, natH: im.naturalHeight, src: im.src.slice(0, 60) }
  })
  console.log('preview img:', JSON.stringify(img))
}

console.log('--- errors ---')
console.log(errors.length ? errors.join('\n') : '(none)')
await page.evaluate(async (id) => window.clipper.deleteJob(id), created.id)
console.log('deleted')
await browser.close()
