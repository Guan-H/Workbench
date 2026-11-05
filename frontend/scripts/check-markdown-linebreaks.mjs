import assert from 'node:assert/strict'

/** Exercise real note creation, editor save, persisted read and visible browser preview. */
export async function checkMarkdownLinebreaks(page, output) {
  const source = 'asdasd\nasdasd\nasdasd'
  const path = '普通换行验证.md'
  const note = await page.evaluate(async ({ path, source }) => {
    const { api } = await import('/src/shared/api/client.ts')
    return api('/notes', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ path, type: 'note', content: source }) })
  }, { path, source })
  const origin = new URL(page.url()).origin
  await page.goto(origin + '/?note=' + encodeURIComponent(path))
  const editor = page.getByTestId('markdown-editor')
  await editor.waitFor()
  const preview = page.locator('.markdown-preview')
  await preview.locator('p br').nth(1).waitFor({ state: 'attached' })
  assert.equal(await preview.locator('p').innerText(), source)
  const positions = await preview.locator('p').evaluate(paragraph => {
    const lines = []
    for (const node of paragraph.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(node)
      lines.push(range.getBoundingClientRect().top)
    }
    return lines
  })
  assert.equal(positions.length, 3)
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'The browser must place the text on three different lines')
  const updated = '第一行\n第二行\n第三行\n\n新段落\n\n- 项目一\n- 项目二\n\n```text\n代码一\n代码二\n```'
  await editor.fill(updated)
  await editor.press('Control+s')
  await page.getByTestId('save-feedback').filter({ hasText: '已保存到服务器' }).waitFor()
  const persisted = await (await page.request.get(origin + '/api/v1/notes/' + note.id)).json()
  assert.equal(persisted.content, updated, 'Saving must retain the exact source without inserting spaces or HTML')
  await preview.getByText('新段落', { exact: true }).waitFor()
  assert.equal(await preview.locator('p').count(), 2)
  assert.equal(await preview.locator('p br').count(), 2)
  assert.equal(await preview.locator('li').count(), 2)
  assert.equal(await preview.locator('pre br').count(), 0)
  assert.equal(await preview.locator('pre code').innerText(), '代码一\n代码二\n')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  assert.equal(await preview.locator('p').first().innerText(), '第一行\n第二行\n第三行')
  await page.screenshot({ path: output + '/markdown-linebreaks-preview.png', fullPage: true })
  await page.reload(); await editor.waitFor()
  await preview.locator('p br').nth(1).waitFor({ state: 'attached' })
  assert.equal(await preview.locator('p').first().innerText(), '第一行\n第二行\n第三行')
  await page.goto(origin)
}
