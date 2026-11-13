import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.APPEARANCE_URL ?? 'http://127.0.0.1:5173'
const username = process.env.APPEARANCE_USERNAME
const password = process.env.APPEARANCE_PASSWORD
const output = process.env.APPEARANCE_OUTPUT ?? '../data/appearance-check'

assert.ok(username && password, 'APPEARANCE_USERNAME and APPEARANCE_PASSWORD are required')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))

function alpha(color) {
  const match = color.match(/^rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)$/)
  return match?.[1] === undefined ? 1 : Number(match[1])
}

async function navigate(name) {
  await page.locator('.global-sidebar').getByRole('button', { name, exact: true }).click()
}

async function background(selector) {
  return page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor)
}

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
  await page.locator('.workspace').waitFor()

  await navigate('设置')
  const appearance = page.locator('.appearance-settings')
  await appearance.waitFor()
  const groups = appearance.getByRole('radiogroup')
  assert.equal(await groups.count(), 2)
  await groups.nth(0).getByText('柔和透景', { exact: true }).click()
  await groups.nth(1).getByText('柔和透景', { exact: true }).click()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('workbench-appearance-v1') ?? 'null'))
  assert.deepEqual(stored, { notes: 'soft', mindmap: 'soft' })
  await page.screenshot({ path: `${output}/settings-desktop.png`, fullPage: true })

  await navigate('笔记')
  await page.locator('.note-main').waitFor()
  const markdown = page.locator('[data-file-path$=".md" i]').first()
  assert.ok(await markdown.count(), 'A real Markdown note is required for the appearance check')
  await markdown.click()
  await page.locator('[data-testid="markdown-editor"]').waitFor()
  const note = {
    rootClasses: await page.locator('.workspace').getAttribute('class'),
    sidebar: await background('.file-sidebar'),
    shell: await background('.note-main'),
    topbar: await background('.note-main .workspace-topbar'),
    sourcePanel: await background('.source-panel'),
    editor: await background('.markdown-editor .cm-editor'),
    scroller: await background('.markdown-editor .cm-scroller'),
    previewPanel: await background('.preview-panel'),
    preview: await background('.markdown-preview'),
    horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  }
  assert.match(note.rootClasses ?? '', /notes-soft-surface/)
  assert.ok(alpha(note.sidebar) < 1, `note sidebar must reveal the background: ${note.sidebar}`)
  assert.ok(alpha(note.shell) < 1, `note shell must reveal the background: ${note.shell}`)
  assert.ok(alpha(note.topbar) > alpha(note.shell), `note controls must remain clearer than the shell: ${note.topbar}`)
  for (const [surface, color] of Object.entries({ sourcePanel: note.sourcePanel, editor: note.editor, scroller: note.scroller, previewPanel: note.previewPanel, preview: note.preview })) {
    assert.equal(alpha(color), 0, `${surface} must inherit the translucent note shell: ${color}`)
  }
  assert.ok(note.horizontalOverflow <= 1, `notes horizontal overflow: ${note.horizontalOverflow}`)
  await page.screenshot({ path: `${output}/notes-desktop.png`, fullPage: true })

  await navigate('思维导图')
  await page.locator('.mindmap-page').waitFor()
  const mindmap = {
    rootClasses: await page.locator('.workspace').getAttribute('class'),
    shell: await background('.mindmap-main'),
    heading: await background('.mindmap-heading'),
    canvasChecked: false,
    canvas: undefined,
    node: undefined,
    horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  }
  assert.match(mindmap.rootClasses ?? '', /mindmap-soft-surface/)
  assert.ok(alpha(mindmap.shell) < alpha(mindmap.heading), `mindmap heading must be clearer than the shell: ${mindmap.heading}`)
  const firstMap = page.locator('[data-map-id]').first()
  if (await firstMap.count()) {
    await firstMap.click()
    await page.locator('.mindmap-canvas').waitFor()
    mindmap.canvas = await background('.mindmap-canvas')
    assert.ok(alpha(mindmap.canvas) < 0.8, `mindmap canvas must reveal the background: ${mindmap.canvas}`)
    const firstNode = page.locator('.map-container me-parent > me-tpc').first()
    if (await firstNode.count()) {
      mindmap.node = await firstNode.evaluate(element => getComputedStyle(element).backgroundColor)
      assert.ok(alpha(mindmap.node) >= 0.9, `mindmap nodes must remain legible: ${mindmap.node}`)
    }
    mindmap.canvasChecked = true
  }
  assert.ok(mindmap.horizontalOverflow <= 1, `mindmap horizontal overflow: ${mindmap.horizontalOverflow}`)
  await page.screenshot({ path: `${output}/mindmap-desktop.png`, fullPage: true })

  await page.reload()
  await page.locator('.workspace').waitFor()
  const persistedClasses = await page.locator('.workspace').getAttribute('class')
  assert.match(persistedClasses ?? '', /notes-soft-surface/)
  assert.match(persistedClasses ?? '', /mindmap-soft-surface/)

  await navigate('设置')
  await page.locator('.appearance-settings').waitFor()
  await page.setViewportSize({ width: 375, height: 844 })
  const mobile = await page.locator('.appearance-settings').evaluate(element => {
    const buttons = [...element.querySelectorAll('.ant-radio-button-wrapper')]
    return {
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      cardRight: element.getBoundingClientRect().right,
      minimumControlHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height)),
    }
  })
  assert.ok(mobile.horizontalOverflow <= 1, `mobile horizontal overflow: ${mobile.horizontalOverflow}`)
  assert.ok(mobile.cardRight <= 375.5, `mobile appearance card exceeds viewport: ${mobile.cardRight}`)
  assert.ok(mobile.minimumControlHeight >= 44, `mobile controls must be at least 44px high: ${mobile.minimumControlHeight}`)
  await appearance.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/settings-mobile.png` })

  assert.deepEqual(errors, [])
  const result = { origin, stored, note, mindmap, persistedClasses, mobile, errors }
  await writeFile(`${output}/result.json`, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
