import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

/** Real authenticated uploads, image downloads and saves; only the timeout case delays a real response. */
export async function checkPreviewImages(page, request, context, origin, output) {
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
    await writeFile(new URL('preview-images.json', output), JSON.stringify({
      imageCount: 6, initialRequests, extraRequestsDuringTextEdits: 0, saveMs,
      responseDelayFaultInjection: 'real PUT committed; response withheld; timeout and idempotent retry verified',
    }, null, 2))
  } finally { page.off('request', countImage) }
}
