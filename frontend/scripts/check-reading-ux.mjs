import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const backend = process.env.READING_UX_BACKEND, port = Number(process.env.READING_UX_PORT), output = process.env.READING_UX_OUTPUT
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(backend) && port && output)
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [vue()], logLevel: 'error',
  optimizeDeps: { include: ['libsodium-wrappers-sumo'] }, server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const origin = `http://127.0.0.1:${port}`
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page = await context.newPage()
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  await page.goto(origin)
  const call = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
    const { api } = await import('/src/shared/api/client.ts')
    return api(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Idempotency-Key': crypto.randomUUID() } })
  }, { path, method, body })
  const delayRequest = milliseconds => async route => {
    await new Promise(resolve => setTimeout(resolve, milliseconds))
    try { await route.continue() }
    catch (error) { if (!/already handled|Target page.*closed/.test(error.message)) throw error }
  }
  await call('/auth/initialize', 'POST', { username: 'reading-ux-it', password: process.env.READING_UX_PASSWORD, setupToken: process.env.READING_UX_SETUP })
  const a = await call('/notes', 'POST', { path: 'ux-note-a.md', type: 'note', content: '# Alpha\n\nSaved alpha.' })
  const b = await call('/notes', 'POST', { path: 'ux-note-b.md', type: 'note', content: '# Beta\n\nSaved beta.' })
  let revision = (await call('/reader/library')).revision
  const change = async body => {
    const result = await call('/reader/library', 'POST', { baseRevision: revision, ...body }); revision = result.revision; return result
  }
  const folder = (await change({ action: 'create-folder', name: '学习书籍', parentId: '' })).id
  const books = []
  for (let index = 0; index < 32; index++) {
    const file = await call('/notes', 'POST', { path: `book-${String(index).padStart(2, '0')}.md`, type: 'note', content: `# 第一章 测试 ${index}\n\n` + (index === 0 ? 'Actual persisted reading text.\n\n'.repeat(12000) : 'A real book source.') })
    books.push(file)
    await change({ action: 'add-book', id: file.id, parentId: index < 2 ? folder : '' })
  }
  await call(`/notes/${books[31].id}?baseVersion=${books[31].version}`, 'DELETE')
  await page.reload()
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor()
  const nav = name => page.locator('.global-sidebar').getByRole('button', { name, exact: true })
  // Match the existing navigation if its structural class changes.
  const menu = name => page.locator('.sidebar').getByRole('button', { name, exact: true })
  const go = async name => {
    const primary = nav(name)
    if (await primary.count()) await primary.click(); else await menu(name).click()
  }
  await go('笔记')
  const select = path => page.locator(`[data-file-path="${path}"]`).first().click()
  await select(a.path)
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Saved alpha.'))
  // Delay real requests only. All responses still come from Spring/MySQL/files.
  await page.route(`**/api/v1/notes/${b.id}`, delayRequest(600))
  await select(b.path)
  await page.getByRole('status').filter({ hasText: '正在切换笔记' }).waitFor()
  assert.ok(await page.locator('.cm-content').textContent().then(text => text.includes('Saved alpha.')))
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Saved beta.'))
  await page.unroute(`**/api/v1/notes/${b.id}`)
  // Save protection is real: switching menus writes edits before leaving.
  await page.locator('.cm-content').fill('# Beta\n\nEdited before navigation.')
  await page.route('**/src/modules/reader/ReadingView.vue*', delayRequest(450))
  await page.route('**/api/v1/reader/library', delayRequest(600))
  requests.length = 0
  await go('阅读')
  await page.getByRole('status').filter({ hasText: '正在读取书籍目录' }).waitFor()
  await page.getByRole('heading', { name: '书籍目录', exact: true }).waitFor()
  await page.locator('.reading-books li').first().waitFor()
  assert.equal(requests.filter(path => path === '/api/v1/notes').length, 0, 'reading must not reload the entire notebook')
  assert.equal(requests.filter(path => path === '/api/v1/reader/library').length, 1)
  assert.equal((await call(`/notes/${b.id}`)).content, '# Beta\n\nEdited before navigation.')
  assert.equal(await page.locator('.reading-books li').count(), 10)
  await page.getByLabel('独立书籍目录').getByText('学习书籍', { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.reading-books li').length === 2)
  // Refresh keeps old rows visible while the genuine request is delayed.
  await page.getByRole('button', { name: '刷新书目', exact: true }).click()
  assert.equal(await page.locator('.reading-books li').count(), 2)
  await page.getByRole('button', { name: '刷新书目', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('.reading-library-tools button')?.disabled)
  await page.screenshot({ path: output + '/reading-desktop.png', animations: 'disabled' })
  await page.getByRole('button', { name: `阅读 ${books[0].path}`, exact: true }).click()
  await page.locator('.reader-content').waitFor()
  await page.waitForFunction(() => document.querySelector('.reader-content')?.textContent.includes('Actual persisted reading text.'))
  await page.getByRole('button', { name: '返回书目', exact: true }).click()
  await page.locator('.reading-books li').first().waitFor()
  await page.unroute('**/api/v1/reader/library')
  await page.unroute('**/src/modules/reader/ReadingView.vue*')
  await go('设置')
  const hook = page.locator('.english-hook')
  await hook.locator('summary').click()
  await hook.getByRole('button', { name: '复制请求格式与限制', exact: true }).click()
  const guide = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(guide.includes(origin + '/api/v1/hooks/english') && guide.includes('Authorization: Bearer <凭证>') && guide.includes('sentences') && guide.includes('1 MiB') && guide.includes('60 次'))
  await page.getByRole('status').filter({ hasText: '请求格式与限制已复制。' }).waitFor()
  await hook.getByRole('button', { name: '复制 JSON 示例', exact: true }).click()
  assert.ok(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).articles[0].sentences.length)
  await page.setViewportSize({ width: 375, height: 844 })
  await hook.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: output + '/webhook-mobile.png', animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Real connection failure: abort, then retry with genuine backend data.
  await page.route('**/api/v1/reader/library', route => route.abort('failed'))
  await go('阅读')
  await page.getByRole('button', { name: '重新读取书目', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: '当前没有书籍', exact: true }).count(), 0)
  await page.unroute('**/api/v1/reader/library')
  await page.getByRole('button', { name: '重新读取书目', exact: true }).click()
  await page.locator('.reading-books li').first().waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await go('同步中心')
  assert.equal(await page.locator('main.home-main').evaluate(element => element.getAnimations().length), 0)
  assert.deepEqual(errors, [])
  await writeFile(output + '/result.json', JSON.stringify({ books: books.length, sourceBodiesExcluded: true, clipboard: true, noNotebookReload: true, errors }, null, 2))
  console.log('PASS reading UX: real persisted sources, no notebook reload, loading/retained rows, navigation saves, clipboard, failure/retry, 375px and reduced motion')
} catch (error) {
  if (page) { await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {}); await writeFile(output + '/failure.html', await page.content()).catch(() => {}) }
  throw error
} finally { await browser?.close(); await server.close() }
