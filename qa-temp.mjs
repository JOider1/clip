import { chromium } from 'playwright-core'
import fs from 'node:fs'

const OUT = 'C:/Users/stasb/AppData/Local/Temp/clipforge-qa'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
let page = null
for (const ctx of browser.contexts()) {
  for (const p of ctx.pages()) {
    if (!page && !p.url().startsWith('devtools')) page = p
  }
}
if (!page) throw new Error('no page')

const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`))

const shot = async (name) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

await page.waitForTimeout(800)
console.log('viewport', await page.evaluate(() => ({ w: innerWidth, h: innerHeight })))

// Library
await page.evaluate(() => {
  const main = document.querySelector('.app-main')
  if (main) main.scrollTop = 0
})
await shot('10-library')

// Settings
await page.getByRole('button', { name: 'Налаштування' }).click()
await page.waitForTimeout(500)
console.log('settings scrollTop:', await page.evaluate(() => document.querySelector('.app-main')?.scrollTop))
await shot('11-settings-top')

// Expand API key help
const summary = page.locator('.key-help summary')
if (await summary.count()) {
  await summary.click()
  await page.waitForTimeout(250)
  await shot('12-key-help')
}

// Template area
const picker = page.locator('.layout-picker')
await picker.scrollIntoViewIfNeeded()
await shot('13-layout-picker')
const geo = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.layout-thumb')].map((el) => {
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }
  })
  return { thumbs: t }
})
console.log(JSON.stringify(geo))

// New job modal
await page.getByRole('button', { name: /Новий кліп/ }).first().click()
await page.waitForTimeout(450)
await shot('14-new-job')

// Close modal with Escape if possible
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

console.log('modal still open:', await page.locator('.modal-card, .modal').count())

console.log('--- console issues ---')
console.log(logs.length ? logs.join('\n') : '(none)')
await browser.close()
