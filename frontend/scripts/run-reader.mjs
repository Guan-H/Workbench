import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const phase = process.argv[2], output = process.env.SESSIONS_OUTPUT, port = Number(process.env.SESSIONS_FRONTEND_PORT), backend = process.env.SESSIONS_BACKEND
assert.ok(['reader','reader-restart'].includes(phase) && output && port && /^http:\/\/127\.0\.0\.1:\d+$/.test(backend))
const root = fileURLToPath(new URL('../', import.meta.url)), fixtures = fileURLToPath(new URL('../../data/novel-fixtures/', import.meta.url))
const server = await createServer({ configFile: false, root, plugins: [vue()], logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: output + '/browser-a.json' })
  page = await context.newPage()
  const errors = [], dialogs = [], unwanted = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
  page.on('request', request => { if (request.url().includes('blocked.reader.test')) unwanted.push(request.url()) })
  await page.goto(`http://127.0.0.1:${port}`)
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '阅读', exact: true }).click()
  const api = (path, method = 'GET', body, operation = crypto.randomUUID()) => page.evaluate(async ({ path, method, body, operation }) => {
    const { api, write } = await import('/src/shared/api/client.ts')
    try { return { status: 200, value: method === 'GET' ? await api(path) : await write(path, method, body, operation) } }
    catch (error) { return { status: error.status || 0, code: error.code, message: error.message } }
  }, { path, method, body, operation })
  const upload = async (name, sourceName = name) => page.evaluate(async ({ name, data }) => {
    const { apiResponse } = await import('/src/shared/api/client.ts')
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0)), form = new FormData()
    form.append('path', name); form.append('file', new Blob([bytes]), name)
    const file = await (await apiResponse('/files', { method: 'POST', body: form, headers: { 'Idempotency-Key': crypto.randomUUID() } })).json()
    const { api: read, write } = await import('/src/shared/api/client.ts')
    const library = await read('/reader/library')
    await write('/reader/library', 'POST', {baseRevision:library.revision,action:'add-book',id:file.id,parentId:''})
    return file
  }, { name, data: (await readFile(fixtures + sourceName)).toString('base64') })
  const library = async () => {
    const back = page.getByRole('button', { name: '返回书目', exact: true })
    if (await back.count()) await back.click()
  }
  const refresh = async () => { await library(); await page.getByRole('button', { name: '刷新书目', exact: true }).click() }
  const open = async name => {
    await library(); await page.getByRole('textbox', { name: '搜索阅读书目', exact: true }).fill(name)
    await page.locator(`[data-reading-path="${name}"]`).click()
    await page.getByRole('region', { name: '书籍阅读器', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.reader-scroll')?.getAttribute('aria-busy') === 'false')
  }
  async function stored(file) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const response = await api(`/reader/files/${file.id}/progress`)
      if (response.value?.revision !== '0' && response.value?.locator) return response.value
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Reading position never reached the real server')
  }
  async function chapter(title) {
    await page.getByRole('button', { name: '章节目录', exact: true }).click()
    await page.getByRole('dialog', { name: '书籍章节目录' }).getByRole('tree').getByText(title, { exact: true }).click()
    await page.getByRole('dialog', { name: '书籍章节目录' }).waitFor({ state: 'detached' })
  }
  if (phase === 'reader-restart') {
    const saved = JSON.parse(await readFile(output + '/reader-result.json', 'utf8'))
    const result = await api(`/reader/files/${saved.file.id}/progress`)
    assert.equal(result.value.sourceHash, saved.file.sha256)
    assert.equal(result.value.locator, saved.locator)
    await open(saved.file.path)
    await page.waitForFunction(() => document.querySelector('.reader-current-chapter')?.textContent.includes('第12章'))
    console.log('PASS: account-sessions-reader-restart real database progress survived backend reconstruction')
  } else {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', {name:'上传书籍',exact:true}).click()
    await (await chooser).setFiles(fixtures + 'long-novel.txt')
    await page.getByRole('button', {name:'确认上传书籍',exact:true}).click()
    await page.getByRole('region', {name:'书籍阅读器',exact:true}).waitFor()
    await page.waitForFunction(() => document.querySelector('.reader-scroll')?.getAttribute('aria-busy') === 'false')
    const file = await page.evaluate(async () => { const { listNotes } = await import('/src/shared/api/client.ts'); return (await listNotes()).find(item => item.path === 'long-novel.txt') })
    assert.ok(file.size > 1024 * 1024, 'Novel must exceed the existing TXT editor limit')
    const epub = await upload('epub3.epub'), old = await upload('epub2.epub'), changedFile = await upload('changed.txt')
    for (const name of ['no-nav.epub','bad-path.epub','bad-entity.epub','encrypted.epub']) await upload(name)
    for (let index = 0; index < 5; index++) await upload(`extra-${index}.txt`, 'changed.txt')
    await refresh()
    await page.waitForFunction(() => document.querySelectorAll('[data-reading-path]').length === 10)
    await page.locator('.reading-pagination').getByRole('button', {name:'下一页',exact:true}).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-reading-path]').length === 3)
    await page.screenshot({path:output+'/reading-library-desktop.png',fullPage:true})
    await page.getByRole('navigation', {name:'主要导航'}).getByRole('button', {name:'笔记',exact:true}).click()
    await page.locator('[data-file-path="changed.txt"]').click()
    await page.getByRole('textbox', {name:'TXT 正文',exact:true}).waitFor()
    assert.equal(await page.getByRole('button', {name:'书籍阅读模式',exact:true}).count(), 0)
    assert.equal(await page.getByRole('region', {name:'书籍阅读器',exact:true}).count(), 0)
    await page.getByRole('navigation', {name:'主要导航'}).getByRole('button', {name:'阅读',exact:true}).click()
    await open('long-novel.txt')
    await page.getByRole('button', { name: '章节目录', exact: true }).click()
    assert.equal(await page.getByRole('tree').getByText('他想起第一章的内容，但这行是普通正文。', { exact: true }).count(), 0)
    await page.getByRole('textbox', { name: '搜索章节名称', exact: true }).fill('第12章')
    await page.getByRole('tree').getByText('第12章 测试旅程', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.reader-current-chapter')?.textContent.includes('第12章'))
    let progress = await stored(file)
    assert.equal(progress.sourceHash, file.sha256)
    assert.ok(await page.locator('.reader-chunk p').count() < 200, 'Long novel must not render every paragraph')
    await page.getByRole('button', { name: '阅读设置', exact: true }).click()
    const fontSlider = page.getByRole('dialog').getByRole('slider').first()
    await fontSlider.focus(); await fontSlider.press('End'); await fontSlider.press('ArrowLeft')
    await page.getByRole('button', { name: '关闭阅读面板', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.reader-current-chapter')?.textContent.includes('第12章'))
    await page.getByRole('button', { name: '下一章', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.reader-current-chapter')?.textContent.includes('第13章'))
    await page.getByRole('button', { name: '上一章', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.reader-current-chapter')?.textContent.includes('第12章'))
    await page.getByRole('button', { name: '全屏阅读', exact: true }).click()
    await page.waitForFunction(() => document.fullscreenElement !== null)
    await page.getByRole('button', { name: '退出沉浸阅读', exact: true }).click()
    await page.waitForFunction(() => document.fullscreenElement === null)
    await page.screenshot({ path: output + '/novel-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 375, height: 850 })
    await page.getByRole('button', { name: '章节目录', exact: true }).click()
    await page.screenshot({ path: output + '/novel-directory-narrow.png', fullPage: true })
    await page.getByRole('button', { name: '关闭阅读面板', exact: true }).click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: output + '/novel-narrow.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(async () => { for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame) })
    await page.locator('.reader-scroll').evaluate(element => { element.scrollTop += 450 })
    for (let attempt = 0; attempt < 70; attempt++) {
      progress = (await api(`/reader/files/${file.id}/progress`)).value
      if (JSON.parse(progress.locator).offset > 0) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!JSON.parse(progress.locator).offset) console.log('Position diagnostics', await page.evaluate(() => {
      const scroller = document.querySelector('.reader-scroll'), rect = scroller.getBoundingClientRect()
      return { top: scroller.scrollTop, height: scroller.scrollHeight, viewportTop: rect.top, blocks: [...scroller.querySelectorAll('[data-reader-block]')].map(item => ({ block: item.dataset.block, top: item.getBoundingClientRect().top, bottom: item.getBoundingClientRect().bottom })).filter(item => item.bottom > rect.top).slice(0, 3) }
    }))
    assert.ok(JSON.parse(progress.locator).offset > 0, 'Progress must include a character position inside a paragraph: ' + progress.locator)
    // A genuine second browser reads only persisted progress, with no localStorage state copied.
    const second = await browser.newContext({ viewport: { width: 1100, height: 800 }, storageState: output + '/browser-a.json' })
    const other = await second.newPage(); await other.goto(`http://127.0.0.1:${port}`)
    await other.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '阅读', exact: true }).click()
    await other.getByRole('textbox', {name:'搜索阅读书目',exact:true}).fill('long-novel.txt')
    await other.locator('[data-reading-path="long-novel.txt"]').click()
    await other.waitForFunction(() => document.querySelector('.reader-current-chapter')?.textContent.includes('第12章'))
    const restored = JSON.parse(progress.locator)
    assert.ok(await other.evaluate(target => {
      const viewport = document.querySelector('.reader-scroll').getBoundingClientRect()
      const block = [...document.querySelectorAll('[data-reader-block]')].find(item => item.dataset.part === target.part && Number(item.dataset.block) === target.block)
      return block && block.getBoundingClientRect().top <= viewport.top + 30 && block.getBoundingClientRect().bottom > viewport.top
    }, restored), 'A new browser must restore the same logical paragraph with different typography')
    progress = (await api(`/reader/files/${file.id}/progress`)).value
    const operation = crypto.randomUUID(), changed = { baseRevision: progress.revision, sourceVersion: file.version, sourceHash: file.sha256, format: 'txt', locator: progress.locator }
    const firstWrite = await api(`/reader/files/${file.id}/progress`, 'PUT', changed, operation)
    const retry = await api(`/reader/files/${file.id}/progress`, 'PUT', changed, operation)
    assert.equal(firstWrite.status, 200); assert.equal(retry.value.revision, firstWrite.value.revision)
    assert.equal((await api(`/reader/files/${file.id}/progress`, 'PUT', changed)).code, 'READING_PROGRESS_CHANGED')
    // No-content-change stale writes still require the observed progress revision.
    await page.getByRole('button', { name: '下一章', exact: true }).click()
    await page.getByText('其他页面或设备已更新阅读位置，本机位置已保留。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '采用本机位置', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.reader-conflict'))
    await page.getByRole('button', { name: '上一章', exact: true }).click()
    await page.locator('.reader-progress-status').click()
    await other.close(); await second.close()
    const currentFile = (await api(`/notes/${file.id}`)).value
    assert.equal(currentFile.version, '1', 'Reading must not edit the source file')
    await open('epub3.epub')
    await chapter('子章节 途中')
    await page.waitForFunction(() => document.querySelector('.reader-current-chapter')?.textContent.includes('子章节'))
    await chapter('第二部 归来')
    await page.getByText('故事结束，欢迎下次继续阅读。', { exact: true }).waitFor()
    await stored(epub)
    await page.screenshot({ path: output + '/novel-epub.png', fullPage: true })
    await open('epub2.epub'); await chapter('旧版第二章'); await stored(old)
    const oldProgress = (await api(`/reader/files/${old.id}/progress`)).value
    const moveRequest = { targetPath: 'renamed.epub', baseVersion: old.version }
    const plan = await api(`/notes/${old.id}/move-preview`, 'POST', moveRequest)
    assert.equal((await api(`/notes/${old.id}/move`, 'POST', { ...moveRequest, fingerprint: plan.value.fingerprint })).status, 200)
    assert.equal((await api(`/reader/files/${old.id}/progress`)).value.locator, oldProgress.locator, 'Renaming keeps file ID and reading state')
    await open('no-nav.epub'); await page.getByText('EPUB 没有可用目录，以下按正文文件阅读顺序导航。', { exact: true }).waitFor()
    for (const [name, text] of [['bad-path.epub','路径不安全'],['bad-entity.epub','实体声明'],['encrypted.epub','不支持带 DRM']]) {
      await open(name); await page.getByRole('alert').filter({ hasText: text }).waitFor()
    }
    const changedPosition = { baseRevision: '0', sourceVersion: changedFile.version, sourceHash: changedFile.sha256, format: 'txt', locator: JSON.stringify({v:1,part:'text',block:1,offset:2,encoding:'UTF-8'}) }
    assert.equal((await api(`/reader/files/${changedFile.id}/progress`, 'PUT', changedPosition)).status, 200)
    assert.equal((await api(`/files/${changedFile.id}/text`, 'PUT', {baseVersion:changedFile.version,path:changedFile.path,content:'全新的文件内容。',encoding:'UTF-8',bom:false})).status, 200)
    assert.equal((await api(`/reader/files/${changedFile.id}/progress`, 'PUT', {...changedPosition,baseRevision:'1'})).code, 'READING_FILE_CHANGED')
    await open('changed.txt')
    await page.getByText('全新的文件内容。', {exact:true}).waitFor()
    await page.getByRole('navigation', {name:'主要导航'}).getByRole('button', {name:'笔记',exact:true}).click()
    await page.locator('[data-file-path="epub3.epub"]').click()
    await page.getByRole('region', {name:'阅读页面',exact:true}).waitFor()
    await page.getByRole('region', {name:'书籍阅读器',exact:true}).waitFor()
    assert.deepEqual(dialogs, []); assert.deepEqual(unwanted, []); assert.deepEqual(errors, [])
    const anonymous = await browser.newContext()
    assert.equal((await anonymous.request.get(`http://127.0.0.1:${port}/api/v1/reader/files/${file.id}/progress`)).status(), 401)
    await anonymous.close()
    const final = (await api(`/reader/files/${file.id}/progress`)).value
    await writeFile(output + '/reader-result.json', JSON.stringify({ file, locator: final.locator }))
    console.log('PASS: account-sessions-reader real TXT/EPUB/browser/MySQL, logical restore, concurrency, idempotency and hostile content')
  }
} catch (error) {
  if (page) await page.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => undefined)
  throw error
} finally { await browser?.close(); await server.close() }
