import assert from 'node:assert/strict'
import { recoverFirstDraft, waitForNoDrafts } from './vault-draft-box-helpers.mjs'

const title = 'M3_SECURE_FAKE_TITLE'
const login = 'M3_SECURE_FAKE_LOGIN'
const rows = page => page.locator('.vault-entry-row')
const editor = page => page.locator('.vault-entry-detail form')
const preview = page => page.getByRole('region', { name: '安全笔记预览', exact: true })
async function select(page, name = title) { await rows(page).filter({ hasText: name }).click() }
async function category(page, name) { await page.getByRole('menuitem', { name }).click() }
async function read(page) { return (await (await page.request.get(new URL('/api/v1/vault', page.url()).href)).json()) }
async function unlock(page, master) {
  await page.getByLabel('保险库主密码', { exact: true }).fill(master)
  await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
  await page.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
}
async function reload(page, master) {
  await page.reload()
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '密码保险库', exact: true }).click()
  await unlock(page, master)
}
async function recover(page) { await recoverFirstDraft(page) }
async function save(page, label = '保存条目') { await page.getByRole('button', { name: label, exact: true }).click(); await editor(page).waitFor({ state: 'detached' }) }
async function remove(page) {
  await page.getByRole('button', { name: '删除条目', exact: true }).click()
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click()
}
async function restore(page) {
  await page.getByRole('button', { name: '恢复条目', exact: true }).click()
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await editor(page).waitFor({ state: 'detached' })
}
// Fault injection loses only the response after the real server has committed the actual ciphertext.
async function loseNextConfirmation(page) {
  let dropped = false
  const handler = async route => {
    if (!dropped && route.request().method() === 'PUT') {
      dropped = true
      const response = await route.fetch()
      assert.equal(response.status(), 200)
      await route.abort('connectionreset')
    } else await route.continue()
  }
  await page.route('**/api/v1/vault', handler)
  return () => page.unroute('**/api/v1/vault', handler)
}

export async function checkVaultTrash(page, output, master) {
  await unlock(page, master)
  let stale
  try {
    await select(page, login)
    const before = BigInt((await read(page)).version)
    await page.getByRole('button', { name: '删除条目', exact: true }).click()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await read(page)).version, String(before))
    const stopLosingDelete = await loseNextConfirmation(page)
    await remove(page)
    await page.getByRole('alert').filter({ hasText: '保存结果尚未确认' }).waitFor()
    await stopLosingDelete()
    assert.equal((await read(page)).version, String(before + 1n))
    await page.getByRole('button', { name: '立即锁定', exact: true }).click()
    await unlock(page, master); await recover(page)
    await waitForNoDrafts(page)
    assert.equal((await read(page)).version, String(before + 1n))
    await category(page, /登录账号/)
    assert.equal(await rows(page).count(), 0)
    await category(page, /保险库回收站/); await select(page, login)
    assert.equal(await page.getByRole('button', { name: '编辑条目', exact: true }).count(), 0)
    assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'password')
    await page.getByRole('button', { name: '恢复条目', exact: true }).click()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await read(page)).version, String(before + 1n))
    const stopLosingRestore = await loseNextConfirmation(page)
    await page.getByRole('button', { name: '恢复条目', exact: true }).click()
    await page.getByRole('button', { name: '确认恢复', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '保存结果尚未确认' }).waitFor()
    await stopLosingRestore()
    await save(page, '重试确认保存')
    assert.equal((await read(page)).version, String(before + 2n))
    assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), 'M3_SECURE_FAKE_PASSWORD')

    // Delete from an old snapshot while another tab has saved newer note content.
    await select(page)
    stale = await page.context().newPage()
    await stale.goto(page.url()); await reload(stale, master); await select(stale)
    await stale.getByRole('button', { name: '编辑条目', exact: true }).click()
    const latestBody = await stale.getByLabel('安全笔记正文', { exact: true }).inputValue() + '\n\nM3_SECURE_FAKE_NEWER_CONTENT'
    await stale.getByLabel('安全笔记正文', { exact: true }).fill(latestBody); await save(stale)
    await remove(page)
    await page.getByRole('alert').filter({ hasText: '服务器版本已变化' }).waitFor()
    await page.getByRole('button', { name: '重新读取并保留草稿', exact: true }).click(); await unlock(page, master); await recover(page)
    await page.getByRole('button', { name: '核对后以当前版本继续编辑', exact: true }).click()
    await page.getByRole('button', { name: '以当前版本继续编辑', exact: true }).click()
    await save(page, '移入回收站')
    await preview(page).getByText('M3_SECURE_FAKE_NEWER_CONTENT', { exact: true }).waitFor()

    // An old edit must not silently resurrect the deleted record.
    await stale.getByRole('button', { name: '编辑条目', exact: true }).click()
    await stale.getByLabel('安全笔记正文', { exact: true }).fill(latestBody + '\n\nM3_SECURE_FAKE_OLD_EDIT')
    await stale.getByRole('button', { name: '保存条目', exact: true }).click()
    await stale.getByRole('alert').filter({ hasText: '服务器版本已变化' }).waitFor()
    await stale.getByRole('button', { name: '重新读取并保留草稿', exact: true }).click(); await unlock(stale, master); await recover(stale)
    await stale.getByRole('button', { name: '核对后以当前版本继续编辑', exact: true }).click()
    await stale.getByRole('alert').filter({ hasText: '请先恢复该条目' }).waitFor()
    assert.equal(await stale.getByRole('button', { name: '保存条目', exact: true }).isDisabled(), true)
    await page.screenshot({ path: output + '/vault-trash-1440.png', fullPage: true })
    await restore(page)
    await preview(page).getByText('M3_SECURE_FAKE_NEWER_CONTENT', { exact: true }).waitFor()
    await stale.getByRole('button', { name: '放弃草稿', exact: true }).click()
    await stale.getByRole('button', { name: '放弃草稿', exact: true }).last().click()
    await stale.close(); stale = undefined

    // Real encrypted fixture records exercise 10/1 pagination without substituting API data.
    const snapshot = await read(page)
    const result = await page.evaluate(async ({ snapshot, master }) => {
      const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      const { moveEntryToTrash, newEntry } = await import('/src/modules/vault/entries.ts')
      const { api } = await import('/src/shared/api/client.ts')
      const worker = new VaultWorker()
      try {
        const opened = await worker.request({ kind: 'unlock', password: master, envelope: snapshot.envelope, id: snapshot.vaultId })
        if (opened.kind !== 'unlocked') throw new Error('Expected genuine decrypted content')
        for (let index = 0; index < 11; index++) opened.entries.push(moveEntryToTrash({ ...newEntry(), name: 'M3_SECURE_FAKE_TRASH_' + index }))
        const sealed = await worker.request({ kind: 'seal', content: { format: 'private-space-vault-content', version: 1, entries: opened.entries } })
        if (sealed.kind !== 'sealed') throw new Error('Expected genuine ciphertext')
        const saved = await api('/vault', { method: 'PUT', body: JSON.stringify({ baseVersion: snapshot.version, envelope: sealed.envelope }), headers: { 'Idempotency-Key': crypto.randomUUID() } })
        return saved.version
      } finally { worker.lock() }
    }, { snapshot, master })
    assert.equal(result, String(BigInt(snapshot.version) + 1n))
    await reload(page, master); await category(page, /保险库回收站/)
    assert.equal(await rows(page).count(), 10)
    await page.getByRole('navigation', { name: '保险库条目分页' }).getByRole('button', { name: '下一页', exact: true }).click()
    assert.equal(await rows(page).count(), 1)
    await page.setViewportSize({ width: 375, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(await page.locator('.vault-categories .vault-menu-label').evaluateAll(labels => labels.every(label => label.scrollWidth <= label.clientWidth)), 'Mobile category labels must not be clipped')
    await page.screenshot({ path: output + '/vault-trash-375.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await category(page, /全部条目/)
    assert.equal(await rows(page).count(), 2)
  } finally { if (stale) await stale.close() }
}

export async function checkVaultTrashRestore(page) {
  await category(page, /保险库回收站/)
  assert.equal(await rows(page).count(), 10)
  await category(page, /全部条目/); await select(page)
  await preview(page).getByText('M3_SECURE_FAKE_NEWER_CONTENT', { exact: true }).waitFor()
}
