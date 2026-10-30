import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { checkNoteMoves } from './check-note-moves.mjs'
import { checkNoteImports } from './check-note-imports.mjs'
import { checkRecycleSelection } from './check-recycle-selection.mjs'
import { checkNoteCreation } from './check-note-creation.mjs'

const phase = process.argv[2]
const backend = process.env.NOTES_BACKEND
const run = process.env.NOTES_RUN
const password = process.env.NOTES_PASSWORD
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
assert.match(run ?? '', /^[\da-f-]{36}$/)
assert.ok(['write', 'restore'].includes(phase) && password && process.env.NOTES_SETUP)
const output = new URL(`../test-results/notes-${run}/`, import.meta.url)
await mkdir(output, { recursive: true })
const server = await createServer({ configFile: false, plugins: [vue()],
  root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'error',
  server: { host: '127.0.0.1', port: Number(process.env.NOTES_FRONTEND_PORT), strictPort: true, proxy: { '/api': backend } } })
let browser
let activePage
try {
  await server.listen()
  const origin = `http://127.0.0.1:${process.env.NOTES_FRONTEND_PORT}`
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true })
  const page = await context.newPage()
  activePage = page
  const errors = []
  page.on('requestfailed', request => console.error('Browser request failed:', request.method(), new URL(request.url()).pathname, request.failure()?.errorText))
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message) })
  const nativeDialogs = []
  page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss() })
  await page.goto(origin)
  await page.getByLabel('用户名', { exact: true }).fill('notes-it')
  await page.getByLabel('登录口令', { exact: true }).fill(password)
  if (phase === 'write') {
    await page.getByLabel('确认登录口令', { exact: true }).fill(password)
    await page.getByLabel('一次性初始化凭证').fill(process.env.NOTES_SETUP)
    await page.getByRole('button', { name: '创建并进入' }).click()
  } else await page.getByRole('button', { name: '进入私有空间' }).click()
  await page.getByRole('navigation', { name: '主要导航' }).waitFor()

  async function request(path, method = 'GET', body, operation = crypto.randomUUID(), extra = {}) {
    return page.evaluate(async ({ path, method, body, operation, extra }) => {
      const tokenResponse = await fetch('/api/v1/auth/csrf')
      const { token } = await tokenResponse.json()
      const response = await fetch('/api/v1' + path, { method, headers: {
        'Content-Type': 'application/json', 'X-CSRF-TOKEN': token, 'Idempotency-Key': operation, ...extra,
      }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: response.status, body: await response.json() }
    }, { path, method, body, operation, extra })
  }
  async function list() { const response = await request('/notes'); assert.equal(response.status, 200); return response.body.items }
  async function poll(fn, predicate, label) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { const value = await fn(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)) }
    throw new Error('Timed out: ' + label)
  }
  const fixture = '\uFEFF---\r\ntitle: 中文 & 特殊字符\r\ntags: [验收]\r\n---\r\n# 真实笔记\r\n[[保留双链]]\r\n\r\n| 列 | 值 |\r\n| --- | --- |\r\n| 中文 | 📝 |\r\n\r\n- [x] 任务\r\n\r\n```java\r\nSystem.out.println("ok");\r\n```\r\n'
  if (phase === 'write') {
    const anonymous = await browser.newContext()
    const unauthenticated = await anonymous.request.get(origin + '/api/v1/notes')
    assert.equal(unauthenticated.status(), 401)
    assert.equal((await anonymous.request.get(origin + '/api/v1/files/content?path=x.md')).status(), 401)
    await anonymous.close()
    const forbidden = await page.evaluate(async () => (await fetch('/api/v1/notes', { method: 'POST', body: '{}' })).status)
    assert.equal(forbidden, 403)
    assert.equal((await request('/notes', 'POST', { path: '../escape.md', type: 'note', content: '' })).status, 400)
    assert.equal((await request('/notes', 'POST', { path: 'CON.md', type: 'note', content: '' })).status, 400)

    await page.getByRole('button', { name: '写下第一篇笔记' }).click()
    await page.getByLabel('笔记名称', { exact: true }).fill('中文 & 测试.md')
    await page.getByRole('button', { name: '创建', exact: true }).click()
    const editor = page.getByTestId('markdown-editor')
    await editor.waitFor()
    const divider = page.getByRole('separator', { name: '调整编辑区和预览区宽度' })
    const sourcePanel = page.locator('.source-panel')
    const initialWidth = (await sourcePanel.boundingBox()).width
    const handle = await divider.boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + 150, handle.y + handle.height / 2, { steps: 8 })
    await page.mouse.up()
    assert.ok((await sourcePanel.boundingBox()).width > initialWidth + 100, 'drag changes actual panel widths')
    assert.equal(await page.locator('.editor-panels').evaluate(element => element.classList.contains('resizing')), false)
    await divider.focus()
    await page.keyboard.press('Home')
    assert.equal(await divider.getAttribute('aria-valuenow'), '20')
    await page.keyboard.press('ArrowRight')
    assert.equal(await divider.getAttribute('aria-valuenow'), '22')
    await page.keyboard.press('End')
    assert.equal(await divider.getAttribute('aria-valuenow'), '80')
    const slider = page.getByRole('slider', { name: '编辑区宽度' })
    const track = await slider.boundingBox()
    await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2)
    assert.ok(Number(await divider.getAttribute('aria-valuenow')) > 35 && Number(await divider.getAttribute('aria-valuenow')) < 65)
    await divider.dblclick()
    assert.equal(await divider.getAttribute('aria-valuenow'), '50')
    assert.ok(Math.abs((await sourcePanel.boundingBox()).width - initialWidth) < 2)
    for (const button of await page.locator('button.icon-button:visible').all()) {
      const label = await button.getAttribute('aria-label')
      assert.ok(label && (await button.getAttribute('title'))?.includes(label), 'icon button has its action name as a native hover tooltip')
      await button.hover()
    }
    // Saving an unchanged note must not cache a completed task and block later writes.
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()
    await page.getByTestId('save-feedback').filter({ hasText: '当前没有未保存的修改' }).waitFor()
    await editor.fill('# 第一版\n\n中文内容 📝\n')
    await page.keyboard.press('Control+s')
    const saveMessage = page.getByTestId('save-feedback').filter({ hasText: '已保存到服务器' })
    await saveMessage.waitFor()
    const saveMessageBox = await saveMessage.boundingBox()
    assert.ok(saveMessageBox && saveMessageBox.y < 80, 'Ctrl+S shows a visible top Message')
    let note = await poll(list, items => items.some(item => item.version === '2'), 'initial save')
    note = note.find(item => item.path === '中文 & 测试.md')
    assert.ok(note)
    assert.equal((await request('/notes/' + note.id)).body.content, '# 第一版\n\n中文内容 📝\n')
    await editor.focus()
    await page.keyboard.press('Control+s')
    await page.getByTestId('save-feedback').filter({ hasText: '当前没有未保存的修改' }).waitFor()
    await editor.fill('# 按钮保存的第二轮\n')
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()
    await page.getByTestId('save-feedback').filter({ hasText: '已保存到服务器' }).waitFor()
    assert.equal((await request('/notes/' + note.id)).body.content, '# 按钮保存的第二轮\n')
    await editor.fill('# 第一版\n\n中文内容 📝\n')
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()
    await page.getByTestId('save-feedback').filter({ hasText: '已保存到服务器' }).waitFor()
    note = (await request('/notes/' + note.id)).body
    const operation = crypto.randomUUID()
    const body = { path: note.path, type: 'note', content: '# 来自另一端\n', baseVersion: note.version }
    const saved = await request('/notes/' + note.id, 'PUT', body, operation)
    assert.equal(saved.status, 200)
    assert.equal((await request('/notes/' + note.id, 'PUT', body, operation)).body.version, saved.body.version)
    await editor.fill('# 本机尚未合并\n')
    await page.keyboard.press('Control+s')
    await page.getByText('检测到版本冲突，服务器与本机草稿均已保留。').waitFor()
    assert.equal((await request('/notes/' + note.id)).body.content, body.content)
    await page.getByRole('button', { name: '对比并处理', exact: true }).click()
    await page.getByRole('button', { name: '采用服务器版本', exact: true }).click()
    await page.getByRole('alertdialog', { name: '处理版本冲突', exact: true }).getByRole('button', { name: '采用服务器版本', exact: true }).click()
    await poll(() => editor.innerText(), value => value.includes('来自另一端'), 'conflict resolve')

    await context.setOffline(true)
    await editor.fill('# 离线草稿\n\n断网仍保留。\n')
    await page.keyboard.press('Control+s')
    await page.getByText('保存失败，本机草稿待提交', { exact: true }).waitFor()
    await page.getByTestId('save-feedback').filter({ hasText: '保存失败' }).waitFor()
    assert.ok(await page.evaluate(id => localStorage.getItem('private-space:draft:notes-it:' + id), note.id))
    await context.setOffline(false)
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()
    await poll(() => request('/notes/' + note.id), response => response.body.content?.startsWith('# 离线草稿'), 'reconnect save')
    let paged = (await request('/notes/' + note.id)).body
    for (let index = 1; index <= 31; index += 1) {
      const response = await request('/notes/' + note.id, 'PUT', {
        path: paged.path, type: 'note', content: `# 分页版本 ${index}\n`, baseVersion: paged.version
      }, crypto.randomUUID())
      assert.equal(response.status, 200)
      paged = response.body
    }
    const firstHistoryPage = await request('/notes/' + note.id + '/history?limit=30')
    assert.equal(firstHistoryPage.status, 200)
    assert.equal(firstHistoryPage.body.items.length, 30)
    assert.ok(firstHistoryPage.body.nextCursor)
    await page.getByRole('button', { name: '历史', exact: true }).click()
    await page.getByText('第 1 页', { exact: true }).waitFor()
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await page.getByText('第 2 页', { exact: true }).waitFor()
    await page.getByRole('button', { name: /^版本 2 / }).click()
    await page.getByText('历史版本内容', { exact: true }).waitFor()
    assert.ok(await page.locator('.history-diff del').count() > 0, 'history comparison marks removed text')
    assert.ok(await page.locator('.history-diff ins').count() > 0, 'history comparison marks current additions')
    await page.getByRole('button', { name: '恢复为新版本', exact: true }).click()
    await page.getByRole('alertdialog', { name: '恢复历史版本', exact: true }).getByRole('button', { name: '确认恢复', exact: true }).click()
    await poll(() => editor.innerText(), value => value.includes('第一版'), 'history restore')
    await page.getByRole('button', { name: '收藏笔记', exact: true }).click()
    await poll(list, items => items.some(item => item.id === note.id && item.favorite), 'favorite')

    await page.locator('input[type=file][accept=".md"]').setInputFiles({ name: '往返.md', mimeType: 'text/markdown', buffer: Buffer.from(fixture) })
    await page.getByRole('alertdialog', { name: '确认导入' }).getByRole('button', { name: '确认导入', exact: true }).click()
    const imported = await poll(list, items => items.some(item => item.path === '往返.md'), 'import')
    const importedNote = imported.find(item => item.path === '往返.md')
    assert.equal((await request('/notes/' + importedNote.id)).body.content, fixture)
    await poll(() => page.locator('.document-tab').innerText(), value => value.includes('往返.md'), 'import selected in UI')
    const download = await context.request.get(origin + '/api/v1/files/content?path=' + encodeURIComponent('往返.md'))
    assert.deepEqual(await download.body(), Buffer.from(fixture))
    await page.getByRole('button', { name: '删除笔记', exact: true }).click()
    await page.getByRole('alertdialog', { name: '删除文件', exact: true }).getByRole('button', { name: '移入回收站', exact: true }).click()
    await page.getByText('已移入回收站', { exact: true }).waitFor()
    await page.getByRole('button', { name: '回收站', exact: true }).click()
    await page.getByRole('button', { name: '往返.md', exact: true }).click()
    await page.getByRole('button', { name: /^版本 1 / }).click()
    await page.getByRole('button', { name: '恢复为新版本', exact: true }).click()
    await page.getByRole('alertdialog', { name: '恢复历史版本', exact: true }).getByRole('button', { name: '确认恢复', exact: true }).click()
    await page.getByTestId('markdown-editor').waitFor()
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    await page.getByRole('button', { name: '上传附件', exact: true }).click()
    await page.locator('input[type=file]:not([accept])').setInputFiles({ name: '图片.png', mimeType: 'image/png', buffer: bytes })
    await poll(list, items => items.some(item => item.type === 'attachment'), 'attachment upload')
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()
    const attachment = (await list()).find(item => item.type === 'attachment')
    const imageResponse = await context.request.get(origin + '/api/v1/files/content?path=' + encodeURIComponent(attachment.path))
    assert.deepEqual(await imageResponse.body(), bytes)
    assert.match(imageResponse.headers()['content-security-policy'], /(?:^|;)\s*sandbox(?:;|$)/)
    await editor.fill('# 安全渲染\n\n<script>window.pwned=true</script>\n\n[坏链接](javascript:alert(1))\n\n![远程](https://example.invalid/track.png)\n')
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()
    await poll(() => request('/notes/' + importedNote.id), response => response.body.content?.startsWith('# 安全渲染\r\n'), 'CRLF editing retained')
    assert.ok(await page.locator('.cm-line').count() > 1, 'CRLF document remains multiple editable lines')
    assert.equal(await page.locator('.markdown-preview script, .markdown-preview a[href^="javascript:"], .markdown-preview img[src^="https:"]').count(), 0)
    assert.equal(await page.evaluate(() => window.pwned), undefined)
    // Exercise real UI responsiveness with the same authenticated content.
    for (const [width, height] of [[1440, 960], [1280, 800], [375, 812], [812, 375]]) {
      await page.setViewportSize({ width, height })
      assert.equal(await divider.isVisible(), width > 1023, 'split handle follows the single-column breakpoint')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`)
      await page.screenshot({ path: fileURLToPath(new URL(`workspace-${width}.png`, output)), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 960 })
    const createState = await checkNoteCreation(page, request, output)
    const moveState = await checkNoteMoves(page, request, list, context, origin, output)
    await checkRecycleSelection(page, request, output)
    const importState = await checkNoteImports(page, request, context, origin, output)
    await writeFile(new URL('state.json', output), JSON.stringify({ id: note.id, path: note.path, imported: importedNote.id, attachment: attachment.path, createState, moveState, importState }))
  } else {
    const state = JSON.parse(await readFile(new URL('state.json', output), 'utf8'))
    const note = await request('/notes/' + state.id)
    assert.equal(note.status, 200)
    assert.equal(note.body.content, '# 第一版\n\n中文内容 📝\n')
    assert.equal(note.body.favorite, true)
    assert.equal((await request('/notes/' + state.createState.folderId)).body.path, '交互测试')
    assert.equal((await request('/notes/' + state.createState.noteId)).body.path, state.createState.notePath)
    assert.ok((await request('/notes/' + state.id + '/history')).body.items.length >= 5)
    assert.equal((await request('/notes/' + state.moveState.id)).body.path, state.moveState.path)
    assert.equal((await request('/notes/' + state.moveState.child)).body.path, '归档/项目/子/内部.md')
    assert.equal((await context.request.get(origin + '/api/v1/files/content?path=' + encodeURIComponent(state.attachment))).status(), 200)
    const importDownload = await context.request.get(origin + '/api/v1/files/content?path=' + encodeURIComponent(state.importState.path))
    assert.equal(importDownload.status(), 200)
    const { createHash } = await import('node:crypto')
    assert.equal(createHash('sha256').update(await importDownload.body()).digest('hex'), state.importState.sha256)
    await page.getByRole('button', { name: state.path, exact: true }).click()
    await page.getByTestId('markdown-editor').waitFor()
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor()
    assert.equal((await context.request.get(origin + '/api/v1/notes')).status(), 401)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(nativeDialogs, [], 'all in-page confirmation flows use application dialogs')
  console.log('PASS: notes-' + phase)
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: fileURLToPath(new URL('failure.png', output)), fullPage: true }).catch(() => {})
    console.error('Visible failure state:', await activePage.locator('body').innerText())
  }
  throw error
} finally { await browser?.close(); await server.close() }
