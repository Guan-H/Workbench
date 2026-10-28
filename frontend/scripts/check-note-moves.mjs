import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

/** Product UI and real HTTP only; called by NotesIT against its isolated MySQL instance. */
export async function checkNoteMoves(page, request, list, context, origin, output) {
  const create = async (path, type = 'folder', content = '') => {
    const response = await request('/notes', 'POST', { path, type, content })
    assert.equal(response.status, 200)
    return response.body
  }
  const read = async id => { const response = await request('/notes/' + id); assert.equal(response.status, 200); return response.body }
  const row = path => page.locator(`[data-file-path="${path}"]`)
  const attachment = (await list()).find(item => item.type === 'attachment')
  assert.ok(attachment)
  const archive = await create('归档')
  const project = await create('项目')
  await create('项目/子')
  const child = await create('项目/子/内部.md', 'note', '[根目录笔记](../../移动样本.md)\n')
  const frontmatter = '\uFEFF---\r\nemoji: 📝\r\nkeep: "[原样](移动样本.md)"\r\n---\r\n'
  const content = frontmatter + `# 移动样本\r\n![图片](${attachment.path})\r\n[自己](移动样本.md#标题)\r\n`
  const source = await create('移动样本.md', 'note', content)
  const code = '`[代码](移动样本.md)`\r\n```md\r\n[围栏](移动样本.md)\r\n```\r\n[[移动样本]]\r\n'
  const reference = await create('引用样本.md', 'note', '[指向](移动样本.md#标题)\r\n\r\n[引用][r]\r\n\r\n[r]: <移动样本.md> "标题"\r\n\r\n' + code)
  await page.getByRole('button', { name: '刷新目录', exact: true }).click()
  await row('移动样本.md').waitFor()
  await page.getByRole('textbox', { name: '搜索笔记', exact: true }).fill('移动样本')
  await page.locator('.result-row[data-file-path="移动样本.md"]').waitFor()
  // Real right click opens a bounded keyboard-operable context menu.
  await row('移动样本.md').click({ button: 'right' })
  await page.screenshot({ path: fileURLToPath(new URL('file-context-menu.png', output)) })
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByLabel('新名称', { exact: true }).fill('已改名.md')
  await page.getByRole('button', { name: '预览变更', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名文件', exact: true })
  await dialog.getByText('需要手动检查（不会自动改写）').waitFor()
  assert.ok((await dialog.locator('.move-preview').innerText()).includes('引用样本.md'))
  await page.screenshot({ path: fileURLToPath(new URL('move-preview.png', output)) })
  await page.getByRole('button', { name: '确认重命名', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await row('移动样本.md').waitFor({ state: 'hidden' })
  await page.getByRole('textbox', { name: '搜索笔记', exact: true }).fill('')
  await row('已改名.md').waitFor()
  let moved = await read(source.id)
  assert.equal(moved.path, '已改名.md')
  assert.ok(moved.content.startsWith(frontmatter))
  let refs = (await read(reference.id)).content
  assert.ok(refs.includes(`[指向](${encodeURIComponent('已改名.md')}#标题)`))
  assert.ok(refs.includes(`[r]: <${encodeURIComponent('已改名.md')}> "标题"`))
  assert.ok(refs.endsWith(code), 'code and unsupported wiki links remain byte-for-byte text')
  assert.equal((await request(`/notes/${source.id}/move-preview`, 'POST', { targetPath: '引用样本.md', baseVersion: moved.version })).status, 409)
  assert.equal((await request(`/notes/${project.id}/move-preview`, 'POST', { targetPath: '项目/子/嵌套', baseVersion: project.version })).status, 400)
  assert.equal((await request(`/notes/${source.id}/move-preview`, 'POST', { targetPath: '../逃逸.md', baseVersion: moved.version })).status, 400)

  // Exercise the context-menu directory picker as well as rename.
  await row('已改名.md').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: '移动到…', exact: true }).click()
  await page.getByLabel('目标目录', { exact: true }).selectOption('归档')
  await page.getByRole('button', { name: '预览变更', exact: true }).click()
  await page.getByRole('button', { name: '确认移动', exact: true }).click()
  await page.getByRole('dialog', { name: '移动文件', exact: true }).waitFor({ state: 'hidden' })
  moved = await read(source.id)
  assert.equal(moved.path, '归档/已改名.md')
  assert.ok(moved.content.includes(`![图片](../${attachment.path})`))
  assert.ok((await read(reference.id)).content.includes(`${encodeURIComponent('归档')}/${encodeURIComponent('已改名.md')}`))
  // Expand the destination and drag back to the explicit root target.
  if (await row('归档').getAttribute('aria-expanded') !== 'true') await row('归档').click()
  await row('归档/已改名.md').dragTo(page.getByRole('button', { name: '根目录 /', exact: true }))
  await page.getByRole('button', { name: '确认移动', exact: true }).click()
  await page.getByRole('dialog', { name: '移动文件', exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await read(source.id)).path, '已改名.md')
  await row('已改名.md').dragTo(row('归档'))
  await page.getByRole('button', { name: '确认移动', exact: true }).click()
  await page.getByRole('dialog', { name: '移动文件', exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await read(source.id)).path, '归档/已改名.md')
  await row('归档/已改名.md').click()
  await page.locator('.markdown-preview img').waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.markdown-preview img')].some(image => image.complete && image.naturalWidth > 0))
  const image = await context.request.get(origin + '/api/v1/files/content?path=' + encodeURIComponent(attachment.path))
  assert.equal(image.status(), 200)
  // Move a folder with descendants; every stable ID survives and outgoing links gain one level.
  const childBefore = await read(child.id)
  await row('项目').dragTo(row('归档'))
  await page.getByRole('button', { name: '确认移动', exact: true }).click()
  await page.getByRole('dialog', { name: '移动文件', exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await read(child.id)).path, '归档/项目/子/内部.md')
  assert.ok((await read(child.id)).content.includes(`../../${encodeURIComponent('已改名.md')}`))
  assert.equal((await request(`/notes/${child.id}/history/${childBefore.version}`)).body.path, '项目/子/内部.md')

  // A new catalog entry between preview/commit invalidates the whole reviewed transaction.
  moved = await read(source.id)
  const payload = { targetPath: '归档/最终名.md', baseVersion: moved.version }
  let preview = await request(`/notes/${source.id}/move-preview`, 'POST', payload)
  assert.equal(preview.status, 200)
  await create('预览后新增.md', 'note', 'invalidate preview')
  const stale = await request(`/notes/${source.id}/move`, 'POST', { ...payload, fingerprint: preview.body.fingerprint })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'PREVIEW_STALE')
  assert.equal((await read(source.id)).path, moved.path)
  preview = await request(`/notes/${source.id}/move-preview`, 'POST', payload)
  const operation = crypto.randomUUID()
  const committed = await request(`/notes/${source.id}/move`, 'POST', { ...payload, fingerprint: preview.body.fingerprint }, operation)
  assert.equal(committed.status, 200)
  const repeated = await request(`/notes/${source.id}/move`, 'POST', { ...payload, fingerprint: preview.body.fingerprint }, operation)
  assert.equal(repeated.status, 200)
  assert.equal(repeated.body.version, committed.body.version)
  assert.equal((await read(source.id)).path, '归档/最终名.md')
  assert.ok((await read(source.id)).content.startsWith(frontmatter))
  // Collision with a recycle-bin path must not overwrite the deleted object.
  const trash = await create('归档/保留名.md', 'note', 'keep trash bytes')
  assert.equal((await request(`/notes/${trash.id}?baseVersion=${trash.version}`, 'DELETE')).status, 200)
  assert.equal((await request(`/notes/${source.id}/move-preview`, 'POST', { targetPath: trash.path, baseVersion: committed.body.version })).status, 409)
  assert.equal((await read(trash.id)).content, 'keep trash bytes')
  assert.equal((await read(archive.id)).type, 'folder')
  return { id: source.id, path: '归档/最终名.md', child: child.id, reference: reference.id }
}
