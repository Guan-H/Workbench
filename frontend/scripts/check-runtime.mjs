import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const expected = process.argv[2] ?? 'ready'
assert.ok(['ready', 'unavailable'].includes(expected), 'Use ready or unavailable')
const baseUrl = process.env.RUNTIME_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' })
const directory = new URL('../test-results/', import.meta.url)
await mkdir(directory, { recursive: true })
const observations = []

try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport)
    const [response] = await Promise.all([
      page.waitForResponse((entry) => entry.url().endsWith('/api/system/health/readiness')),
      page.goto(baseUrl),
    ])
    assert.equal(response.status(), expected === 'ready' ? 200 : 503)
    assert.deepEqual(await response.json(), { status: expected === 'ready' ? 'UP' : 'DOWN' })
    const status = page.getByRole('status')
    await status.getByText(expected === 'ready' ? '服务已就绪' : '服务暂不可用', { exact: false })
      .waitFor({ state: 'visible' })
    assert.equal(await status.getAttribute('aria-busy'), 'false')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)

    const button = page.getByRole('button', { name: '重新检查' })
    await button.focus()
    const [retry] = await Promise.all([
      page.waitForResponse((entry) => entry.url().endsWith('/api/system/health/readiness')),
      page.keyboard.press('Enter'),
    ])
    assert.equal(retry.status(), expected === 'ready' ? 200 : 503)
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.getAttribute('aria-busy') === 'false')
    assert.equal(await button.evaluate((element) => element === document.activeElement), true)
    await page.screenshot({ path: fileURLToPath(new URL(`${expected}-${viewport.width}.png`, directory)), fullPage: true })
    observations.push({ viewport, httpStatus: retry.status(), status: await status.innerText(), keyboardRetry: true, horizontalOverflow: false })
  }
  assert.deepEqual(errors, [])
  await writeFile(new URL(`${expected}.json`, directory), JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl, expected, observations, pageErrors: errors }, null, 2))
  console.log(`PASS: ${expected}, ${observations.length} viewports, real HTTP responses, keyboard retry, no page errors`)
} finally {
  await browser.close()
}
