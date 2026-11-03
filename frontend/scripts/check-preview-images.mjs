import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

/** Real authenticated uploads, image downloads and saves; only the timeout case delays a real response. */
export async function checkPreviewImages(page, request, context, origin, output, gate) {
  const bytes = await readFile(new URL('../../sync-client/verification/fixtures/visual-check.png', import.meta.url))
  const paths = Array.from({ length: 6 }, (_, index) => `预览图片 ${index + 1}.png`)
  for (const path of paths) {
    const csrf = await context.request.get(origin + '/api/v1/auth/csrf')
    const { token } = await csrf.json()
    const uploaded = await context.request.post(origin + '/api/v1/files', {
      headers: { Origin: origin, 'X-CSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() },
      multipart: { path, file: { name: path, mimeType: 'image/png', buffer: bytes } },
    })
    assert.equal(uploaded.status(), 200)
  }
  const content = '# 图片预览\n\n' + paths.map((path, index) => `## 设置 ${index + 1}\n\n![设置${index + 1}](<${path}>)\n`).join('\n')
  const created = await request('/notes', 'POST', { path: '图片预览验收.md', type: 'note', content })
  assert.equal(created.status, 200)
  const note = created.body
  const counts = new Map(paths.map(path => [path, 0]))
  const countImage = request => {
    const url = new URL(request.url())
    const path = url.searchParams.get('path')
    if (url.pathname === '/api/v1/files/content' && counts.has(path)) counts.set(path, counts.get(path) + 1)
  }
  page.on('request', countImage)
  const editor = page.getByTestId('markdown-editor')
  const images = page.locator('.markdown-preview img')
  try {
    await page.getByRole('button', { name: '刷新目录', exact: true }).click()
    await page.locator(`[data-file-id="${note.id}"]`).click()
    await images.nth(5).waitFor({ state: 'attached' })
    assert.equal(await page.locator('.markdown-preview h1').innerText(), '图片预览')
    for (let index = 0; index < 6; index++) {
      await images.nth(index).scrollIntoViewIfNeeded()
      await page.waitForFunction(index => {
        const image = document.querySelectorAll('.markdown-preview img')[index]
        return image?.complete && image.naturalWidth > 0
      }, index)
    }
    const initialRequests = [...counts.values()].reduce((sum, count) => sum + count, 0)
    await images.evaluateAll(images => { window.previewImageNodes = images })
    for (let index = 0; index < 5; index++) await editor.fill(`开头新增段落 ${index}\n\n` + content)
    await page.waitForFunction(() => document.querySelector('.markdown-preview')?.textContent.includes('开头新增段落 4'))
    assert.equal(await images.evaluateAll(images => images.every((image, index) => image === window.previewImageNodes[index])), true)
    assert.equal([...counts.values()].reduce((sum, count) => sum + count, 0), initialRequests, 'text edits do not repeat private image requests')

    const edited = ('开头新增段落 4\n\n' + content).replace(paths[0], paths[1])
    const saveStarted = Date.now()
    await editor.fill(edited)
    await page.keyboard.press('Control+s')
    await page.getByTestId('save-feedback').filter({ hasText: '已保存到服务器' }).waitFor()
    const saveMs = Date.now() - saveStarted
    await page.waitForFunction(path => document.querySelector('.markdown-preview img')?.getAttribute('src')?.includes(encodeURIComponent(path)), paths[1])
    assert.equal((await request('/notes/' + note.id)).body.content, edited)

    // Fault injection: commit the real PUT, withhold its genuine response until the client times out.
    let release
    const withheld = new Promise(resolve => { release = resolve })
    let firstOperation
    let firstVersion
    const endpoint = `**/api/v1/notes/${note.id}`
    const delayResponse = async route => {
      if (route.request().method() !== 'PUT' || firstOperation) { await route.continue(); return }
      firstOperation = route.request().headers()['idempotency-key']
      const response = await route.fetch()
      assert.equal(response.status(), 200)
      firstVersion = (await response.json()).version
      await withheld
      await route.fulfill({ response }).catch(() => {})
    }
    await page.route(endpoint, delayResponse)
    const finalContent = edited + '\n超时后必须保留的真实草稿\n'
    try {
      await editor.fill(finalContent)
      await page.keyboard.press('Control+s')
      await page.getByTestId('save-feedback').filter({ hasText: '服务器结果尚未确认' }).waitFor({ timeout: 40000 })
      assert.ok(firstOperation && firstVersion)
      const draft = await page.evaluate(id => JSON.parse(localStorage.getItem('private-space:draft:notes-it:' + id)), note.id)
      assert.equal(draft.text, finalContent)
      assert.equal(draft.pending.operation, firstOperation)
      release()
      await page.unroute(endpoint, delayResponse)
      await page.getByRole('button', { name: '保存笔记', exact: true }).click()
      await page.getByTestId('save-feedback').filter({ hasText: '已保存到服务器' }).waitFor()
      const saved = (await request('/notes/' + note.id)).body
      assert.equal(saved.content, finalContent)
      assert.equal(saved.version, firstVersion, 'same-operation retry does not create another version')
    } finally { release(); await page.unroute(endpoint, delayResponse) }
    const target = (await request('/notes', 'POST', { path: '图片切换目标.md', type: 'note', content: '# 可立即切换\n' })).body
    await page.getByRole('button', { name: '刷新目录', exact: true }).click()
    const open = async id => { await page.locator(`[data-file-id="${id}"]`).click() }
    await open(target.id)
    await page.waitForFunction(() => document.querySelector('.markdown-preview h1')?.textContent === '可立即切换')
    try {
      let held = gate.arm(url => url.startsWith('/api/v1/files/content?'))
      await open(note.id)
      assert.equal((await held).status, 200)
      await images.evaluateAll(images => { window.pendingPreviewImages = images })
      let releaseSwitchSave, savedSwitch
      const switchSave = new Promise(resolve => { releaseSwitchSave = resolve })
      const switchCommitted = new Promise(resolve => { savedSwitch = resolve })
      const holdSwitchSave = async route => {
        if (route.request().method() !== 'PUT') { await route.continue(); return }
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        savedSwitch()
        await switchSave
        await route.fulfill({ response }).catch(() => {})
      }
      await page.route(endpoint, holdSwitchSave)
      try {
        await editor.fill(finalContent + '\n切换前的真实草稿\n')
        await open(target.id)
        await switchCommitted
        assert.equal(await page.evaluate(() => window.pendingPreviewImages.every(image => !image.hasAttribute('src'))), true)
        const deadline = Date.now() + 3000
        while (!gate.cancelled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
        assert.ok(gate.cancelled > 0, 'switching cancels unfinished image HTTP even while waiting for the real save acknowledgement')
        releaseSwitchSave()
        await page.waitForFunction(() => document.querySelector('.markdown-preview h1')?.textContent === '可立即切换')
      } finally { releaseSwitchSave(); await page.unroute(endpoint, holdSwitchSave) }
      gate.release()

      held = gate.arm(url => url.startsWith('/api/v1/files/content?'))
      await open(note.id)
      assert.equal((await held).status, 200)
      await page.getByRole('status').filter({ hasText: '图片加载失败或超时' }).first().waitFor({ timeout: 25000 })
      gate.release()
      await page.getByRole('button', { name: '重新加载', exact: true }).first().click()
      await page.waitForFunction(() => [...document.querySelectorAll('.markdown-preview img')].some(image => image.complete && image.naturalWidth > 0))

      await open(target.id)
      await page.waitForFunction(() => document.querySelector('.markdown-preview h1')?.textContent === '可立即切换')
      held = gate.arm(url => url === `/api/v1/notes/${note.id}`)
      await open(note.id)
      assert.equal((await held).status, 200)
      await open(target.id)
      gate.release()
      assert.equal((await editor.innerText()).trim(), '# 可立即切换', 'cancelled note read cannot overwrite the current note')

      held = gate.arm(url => url === `/api/v1/notes/${note.id}`)
      await open(note.id)
      assert.equal((await held).status, 200)
      await page.getByRole('alert').filter({ hasText: '笔记读取超时' }).waitFor({ timeout: 25000 })
      assert.equal((await editor.innerText()).trim(), '# 可立即切换')
      gate.release()

      held = gate.arm(url => url.startsWith('/api/v1/files/content?'))
      await open(note.id)
      assert.equal((await held).status, 200)
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 })
      await page.getByRole('heading', { name: '工作台', exact: true }).waitFor({ timeout: 10000 })
      gate.release()
      await page.getByRole('button', { name: '进入笔记', exact: true }).click()
    } finally { gate.release() }
    await writeFile(new URL('preview-images.json', output), JSON.stringify({
      imageCount: 6, initialRequests, extraRequestsDuringTextEdits: 0, saveMs,
      responseDelayFaultInjection: 'real PUT committed; response withheld; timeout and idempotent retry verified',
      imageDelayFaultInjection: 'real image bytes delayed over HTTP; switch cancels connection, timeout and retry work, reload remains available',
      noteReadCancellation: 'real GET delayed; current-note selection cancels pending read; timeout retains content and retry works',
    }, null, 2))
  } finally { page.off('request', countImage) }
}
