import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { checkHomeDashboard } from './check-home-dashboard.mjs'

/** Uses real authenticated notes, native mouse selection and browser tabs against the product server. */
export async function checkWorkspaceInteractions(page, request, output, origin) {
  const target = await request('/notes', 'POST', { path: '新标签目标 文档.md', type: 'note', content: '# 新标签目标\n\n真实后端读取的目标内容\n' })
  assert.equal(target.status, 200)
  const content = '# 交互验证\n\nalpha alpha alpha\n第二行文字\n\n' +
    '[库内笔记](<新标签目标 文档.md>)\n\n' +
    `[外部地址](${origin}/api/system/health/readiness)\n`
  const created = await request('/notes', 'POST', { path: '选区与链接验收.md', type: 'note', content })
  assert.equal(created.status, 200)
  await page.getByRole('button', { name: '刷新目录', exact: true }).click()
  await page.locator(`[data-file-id="${created.body.id}"]`).click()
  const editor = page.getByTestId('markdown-editor')
  await page.waitForFunction(() => document.querySelector('.document-tab')?.textContent.includes('选区与链接验收.md'))
  const line = page.locator('.cm-line').filter({ hasText: /^alpha alpha alpha$/ })
  await line.waitFor()
  const wordBox = await line.evaluate(element => {
    const text = element.firstChild
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Expected editable plain text')
    const range = document.createRange()
    range.setStart(text, 0); range.setEnd(text, 5)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  await page.mouse.dblclick(wordBox.x + wordBox.width / 2, wordBox.y + wordBox.height / 2)
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), 'alpha')
  const selection = page.locator('.cm-selectionBackground').first()
  await selection.waitFor()
  const selectionBox = await selection.boundingBox()
  assert.ok(selectionBox && selectionBox.width > 20 && selectionBox.height > 5)
  const activeBackground = await line.evaluate(element => getComputedStyle(element).backgroundColor)
  assert.match(activeBackground, /^rgba\(/, 'active line must be translucent so it cannot cover the selection layer')
  const alpha = Number(activeBackground.split(',').at(-1).replace(')', '').trim())
  assert.ok(alpha < 0.15)
  assert.equal(await selection.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(191, 220, 202)')
  await page.screenshot({ path: fileURLToPath(new URL('selection-double-click.png', output)) })

  await page.keyboard.press('ArrowLeft')
  const lineBox = await line.boundingBox()
  await page.mouse.move(wordBox.x + 1, wordBox.y + wordBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(wordBox.x + wordBox.width * 2.4, wordBox.y + wordBox.height / 2, { steps: 12 })
  await page.mouse.up()
  assert.ok((await page.evaluate(() => window.getSelection()?.toString()))?.length > 5)
  await page.screenshot({ path: fileURLToPath(new URL('selection-single-line.png', output)) })
  await page.keyboard.press('ArrowLeft')
  await page.mouse.move(wordBox.x + 1, wordBox.y + wordBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(wordBox.x + 60, lineBox.y + lineBox.height * 1.5, { steps: 12 })
  await page.mouse.up()
  assert.ok((await page.evaluate(() => window.getSelection()?.toString()))?.includes('\n'))
  await page.screenshot({ path: fileURLToPath(new URL('selection-multi-line.png', output)) })

  const originalUrl = page.url()
  const internalLink = page.locator('.markdown-preview a').filter({ hasText: '库内笔记' })
  assert.equal(await internalLink.getAttribute('target'), '_blank')
  const internalOpened = page.context().waitForEvent('page')
  await internalLink.click()
  const internal = await internalOpened
  try {
    await internal.getByTestId('markdown-editor').waitFor()
    assert.equal(new URL(internal.url()).searchParams.get('note'), target.body.path)
    assert.ok((await internal.getByTestId('markdown-editor').innerText()).includes('真实后端读取的目标内容'))
    assert.equal(await internal.evaluate(() => window.opener === null), true)
  } finally { await internal.close() }
  assert.equal(page.url(), originalUrl)
  assert.ok((await editor.innerText()).includes('alpha alpha alpha'))
  const externalOpened = page.context().waitForEvent('page')
  await page.locator('.markdown-preview a').filter({ hasText: '外部地址' }).click()
  const external = await externalOpened
  try {
    await external.waitForLoadState()
    assert.equal(new URL(external.url()).pathname, '/api/system/health/readiness')
    assert.ok((await external.locator('body').innerText()).includes('UP'))
    assert.equal(await external.evaluate(() => window.opener === null), true)
  } finally { await external.close() }
  assert.equal(page.url(), originalUrl)
  assert.ok((await editor.innerText()).includes('alpha alpha alpha'))

  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '工作台', exact: true }).click()
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor()
  assert.equal(await page.locator('.file-sidebar').isVisible(), false)
  for (const [width, height] of [[1440, 960], [375, 812], [812, 375]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('button', { name: '进入笔记', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: fileURLToPath(new URL(`home-${width}.png`, output)) })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '进入笔记', exact: true }).click()
  await editor.waitFor()
  assert.ok((await editor.innerText()).includes('alpha alpha alpha'))
  assert.equal((await request('/notes/' + created.body.id)).body.content, content)
  await writeFile(new URL('workspace-interactions.json', output), JSON.stringify({
    home: 'authenticated landing page and return-to-note verified at desktop, narrow and landscape widths',
    selection: 'native double-click, single-line drag and multi-line drag verified; screenshots recorded',
    links: 'real note and health endpoint opened in separate browser tabs; opener null; original page retained',
  }, null, 2))
  await checkHomeDashboard(page, request, output)
}
