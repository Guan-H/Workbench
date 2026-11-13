import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.HOME_LAYOUT_URL ?? 'http://127.0.0.1:5173'
const username = process.env.HOME_LAYOUT_USERNAME
const password = process.env.HOME_LAYOUT_PASSWORD
const output = process.env.HOME_LAYOUT_OUTPUT ?? '../data/home-layout-check'

assert.ok(username && password, 'HOME_LAYOUT_USERNAME and HOME_LAYOUT_PASSWORD are required')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(origin)
  const login = await page.evaluate(async credentials => {
    const { api } = await import('/src/shared/api/client.ts')
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify(credentials) })
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }, { username, password })
  assert.equal(login.ok, true, login.message)
  await page.reload()
  await page.locator('.home-dashboard').waitFor()
  await page.locator('.home-calendar').waitFor()

  const desktop = await page.evaluate(() => {
    const box = selector => document.querySelector(selector)?.getBoundingClientRect()
    const content = document.querySelector('.home-content')
    const heading = box('.home-heading')
    const calendar = box('.home-calendar')
    const side = box('.home-side')
    const learning = box('.learning-summary')
    const documents = box('.home-documents')
    return {
      pageScroll: content ? content.scrollHeight - content.clientHeight : Number.NaN,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      headingTop: heading?.top,
      calendarTop: calendar?.top,
      sideBottom: side?.bottom,
      calendarBottom: calendar?.bottom,
      learningHeight: learning?.height,
      learningBottom: learning?.bottom,
      documentsTop: documents?.top,
      documentsHeight: documents?.height,
    }
  })
  assert.ok(desktop.pageScroll <= 1, `desktop page scroll: ${desktop.pageScroll}`)
  assert.ok(desktop.horizontalOverflow <= 1, `desktop horizontal overflow: ${desktop.horizontalOverflow}`)
  assert.ok(Math.abs(desktop.headingTop - desktop.calendarTop) <= 1, 'desktop columns must align at the top')
  assert.ok(Math.abs(desktop.sideBottom - desktop.calendarBottom) <= 1, 'desktop columns must align at the bottom')
  assert.ok(desktop.learningHeight <= 220, `learning summary is too tall: ${desktop.learningHeight}`)
  assert.ok(desktop.documentsTop - desktop.learningBottom <= 17, 'document overview must follow the learning summary closely')
  assert.ok(desktop.documentsHeight <= 220, `document overview is too tall: ${desktop.documentsHeight}`)
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true })

  await page.setViewportSize({ width: 375, height: 844 })
  const mobile = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    pageScrollable: document.querySelector('.home-content').scrollHeight > document.querySelector('.home-content').clientHeight,
  }))
  assert.ok(mobile.horizontalOverflow <= 1, `mobile horizontal overflow: ${mobile.horizontalOverflow}`)
  assert.equal(mobile.pageScrollable, true, 'mobile layout should keep natural page scrolling')
  await page.locator('.home-calendar').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/mobile.png` })

  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ desktop, mobile, errors }))
} finally {
  await browser.close()
}
