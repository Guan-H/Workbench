import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

/** Real UI, authenticated HTTP and persistent recycle snapshots. */
export async function checkRecycleSelection(page, request, output) {
  const create = async (path, type = 'folder', content = '') => {
    const response = await request('/notes', 'POST', { path, type, content })
    assert.equal(response.status, 200)
    return response.body
  }
  const read = async id => (await request('/notes/' + id)).body
  const root = await create('多选回收')
  await create('多选回收/甲')
  await create('多选回收/乙')
  const first = await create('多选回收/甲/第一.md', 'note', '# 第一\r\n原始内容\r\n')
  const second = await create('多选回收/乙/第二.md', 'note', '# 第二\n原始内容\n')
  await create('恢复目标')
  assert.equal((await request(`/notes/${root.id}?baseVersion=${root.version}`, 'DELETE')).status, 200)
  await page.getByRole('button', { name: '刷新目录', exact: true }).click()
  const navigation = page.getByRole('navigation', { name: '主要导航' })
  await navigation.getByRole('button', { name: '回收站', exact: true }).click()
  const row = page.locator('.result-row[data-file-path="多选回收"]')
  await row.waitFor()
  assert.equal(await page.locator('.result-row[data-file-path^="多选回收/"]').count(), 0, 'folder deletion is one recycle entry, not a flat list of its descendants')
  const grouped = await request('/notes?deleted=true&includeGroups=true')
  assert.equal(grouped.status, 200)
  assert.ok(grouped.body.items.some(item => item.id === root.id))
  assert.ok(!grouped.body.items.some(item => item.path.startsWith('多选回收/')))
  const raw = await request('/notes?deleted=true')
  assert.ok(raw.body.items.some(item => item.id === first.id), 'raw deleted listing remains compatible')
  const dialog = page.getByRole('dialog', { name: '恢复回收站目录', exact: true })
  async function open() {
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '恢复', exact: true }).click()
    await dialog.getByRole('button', { name: /选择文件恢复/ }).waitFor()
  }
  async function choose(path, subfolder) {
    await dialog.getByRole('button', { name: /选择文件恢复/ }).click()
    await dialog.getByRole('button', { name: '展开目录：多选回收', exact: true }).click()
    await dialog.getByRole('button', { name: '展开目录：多选回收/' + subfolder, exact: true }).click()
    await dialog.getByRole('checkbox', { name: path, exact: true }).check()
    await dialog.getByRole('button', { name: '下一步：选择恢复位置', exact: true }).click()
  }
  async function commit() {
    await dialog.getByRole('button', { name: '确认恢复', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  await open()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await read(first.id)).deleted, true)
  await open()
  await choose(first.path, '甲')
  await dialog.getByRole('button', { name: /恢复到指定目录/ }).click()
  await dialog.getByRole('button', { name: '选择恢复目标目录', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择恢复目标目录', exact: true })
  await picker.getByLabel('查找目录', { exact: true }).fill('恢复目标')
  await picker.getByRole('button', { name: '选择目录：恢复目标', exact: true }).click()
  await picker.getByRole('button', { name: '使用此目录', exact: true }).click()
  await dialog.getByRole('button', { name: '预览恢复', exact: true }).click()
  await dialog.getByText('→ 恢复目标/第一.md', { exact: true }).waitFor()
  for (const [width, height] of [[1440, 960], [375, 812], [812, 375]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: fileURLToPath(new URL(`recycle-selected-preview-${width}.png`, output)), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await commit()
  assert.equal((await read(first.id)).path, '恢复目标/第一.md')
  assert.equal((await read(first.id)).content, first.content)
  assert.equal((await read(second.id)).deleted, true)

  await open()
  await choose(second.path, '乙')
  await dialog.getByRole('button', { name: /恢复到原目录/ }).click()
  await dialog.getByText('→ 多选回收/乙/第二.md', { exact: true }).waitFor()
  await commit()
  assert.equal((await read(second.id)).content, second.content)
  assert.equal((await read(root.id)).deleted, false)
  await row.getByText('尚有待恢复子项', { exact: false }).waitFor()
  assert.equal(await page.locator('.result-row[data-file-path^="多选回收/"]').count(), 0, 'partly restored containers still hide their remaining descendants')
  // Root is now live but remains a recycle container for its unrecovered empty directory.
  await open()
  await dialog.getByRole('button', { name: /恢复整个文件夹/ }).click()
  await commit()
  await row.waitFor({ state: 'hidden' })
  assert.equal((await read(first.id)).path, '恢复目标/第一.md', 'already restored files are not moved back by whole-directory recovery')
  await navigation.getByRole('button', { name: '笔记', exact: true }).click()
}
