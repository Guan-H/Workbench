import assert from 'node:assert/strict'
import { openDraftBox } from './vault-draft-box-helpers.mjs'

const box = page => page.locator('.vault-draft-box')
const rows = page => box(page).locator('[data-draft-id]')
const editor = page => page.locator('.vault-entry-detail form')
async function drafts(page) {
  return page.evaluate(async () => {
    const { listVaultDrafts } = await import('/src/modules/vault/draft-store.ts')
    const snapshot = await (await fetch('/api/v1/vault')).json()
    return listVaultDrafts(snapshot.vaultId)
  })
}
async function version(page) { return (await (await page.request.get(new URL('/api/v1/vault', page.url()).href)).json()).version }

export async function checkVaultDraftBox(page, output, master) {
  await page.getByLabel('保险库主密码', { exact: true }).fill(master)
  await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
  await page.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
  assert.equal(await page.getByText(/本机有 .*份未提交的加密草稿/).count(), 0)
  await openDraftBox(page)
  await box(page).getByText('草稿箱为空', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭草稿箱', exact: true }).click()
  // Seed real encrypted records through the actual Worker and IndexedDB implementation, not UI stubs.
  await page.evaluate(async master => {
    const snapshot = await (await fetch('/api/v1/vault')).json()
    const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
    const { newEntry, replaceEntry } = await import('/src/modules/vault/entries.ts')
    const { putVaultDraft } = await import('/src/modules/vault/draft-store.ts')
    const worker = new VaultWorker()
    try {
      const opened = await worker.request({ kind: 'unlock', password: master, envelope: snapshot.envelope, id: snapshot.vaultId })
      if (opened.kind !== 'unlocked') throw new Error('Expected real unlocked vault')
      for (let index = 0; index < 12; index++) {
        const entry = { ...newEntry(index % 2 ? 'secure-note' : 'login'), name: 'M3_SECURE_FAKE_BOX_' + String(index).padStart(2, '0') }
        if (entry.type === 'login') entry.password = 'M3_SECURE_FAKE_BOX_SECRET_NOT_FOR_LIST'
        else entry.body = 'M3_SECURE_FAKE_BOX_SECRET_NOT_FOR_LIST'
        const result = await worker.request({ kind: 'draft', draft: { format: 'private-space-vault-draft-content', version: 1, baseVersion: snapshot.version, entry, original: null } })
        if (result.kind !== 'draft') throw new Error('Expected actual draft ciphertext')
        let pending
        if (index === 0) {
          const candidate = await worker.request({ kind: 'seal', content: { format: 'private-space-vault-content', version: 1, entries: replaceEntry(opened.entries, entry) } })
          if (candidate.kind !== 'sealed') throw new Error('Expected genuine pending ciphertext')
          pending = { baseVersion: snapshot.version, operation: crypto.randomUUID(), envelope: candidate.envelope }
        }
        await putVaultDraft({ id: crypto.randomUUID(), vaultId: snapshot.vaultId, updatedAt: new Date(Date.now() - 20000 + index * 1000).toISOString(), envelope: result.envelope, ...(pending ? { pending } : {}) })
      }
    } finally { worker.lock() }
  }, master)
  await openDraftBox(page)
  await rows(page).first().getByRole('button', { name: '继续编辑', exact: true }).waitFor({ state: 'visible' })
  assert.equal(await rows(page).count(), 10)
  assert.ok(!(await box(page).innerText()).includes('M3_SECURE_FAKE_BOX_SECRET_NOT_FOR_LIST'))
  for (const [width, height] of [[1440, 900], [375, 700]]) {
    await page.setViewportSize({ width, height })
    await box(page).locator('header h2').hover()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const footer = await box(page).locator('footer').boundingBox()
    assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= height)
    assert.ok(await box(page).locator('.vault-draft-box-body').evaluate(element => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto'))
    await page.screenshot({ path: output + '/vault-draft-box-' + width + '.png', fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('navigation', { name: '草稿箱分页', exact: true }).getByRole('button', { name: '下一页', exact: true }).click()
  assert.equal(await rows(page).count(), 2)
  const chosen = rows(page).filter({ hasText: 'M3_SECURE_FAKE_BOX_00' })
  await chosen.getByText('保存待确认', { exact: true }).waitFor()
  await chosen.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByLabel('条目名称', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('条目名称', { exact: true }).inputValue(), 'M3_SECURE_FAKE_BOX_00')
  await page.getByRole('button', { name: '重试确认保存', exact: true }).click(); await editor(page).waitFor({ state: 'detached' })
  assert.equal((await drafts(page)).length, 11)
  const savedVersion = await version(page)
  await openDraftBox(page)
  await rows(page).first().getByRole('button', { name: '放弃草稿', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await box(page).waitFor(); assert.equal((await drafts(page)).length, 11)
  await rows(page).first().getByRole('button', { name: '放弃草稿', exact: true }).click()
  await page.locator('.confirmation-dialog').getByRole('button', { name: '放弃草稿', exact: true }).click()
  await box(page).waitFor(); assert.equal((await drafts(page)).length, 10)
  assert.equal(await version(page), savedVersion)
  await page.getByRole('button', { name: '关闭草稿箱', exact: true }).click()

  await page.getByRole('button', { name: '新增登录条目', exact: true }).click()
  await page.getByLabel('条目名称', { exact: true }).fill('M3_SECURE_FAKE_BOX_CURRENT')
  await openDraftBox(page)
  const current = rows(page).filter({ hasText: 'M3_SECURE_FAKE_BOX_CURRENT' })
  await current.getByRole('button', { name: '返回编辑', exact: true }).click()
  assert.equal(await page.getByLabel('条目名称', { exact: true }).inputValue(), 'M3_SECURE_FAKE_BOX_CURRENT')
  await openDraftBox(page)
  await rows(page).filter({ hasText: 'M3_SECURE_FAKE_BOX_CURRENT' }).getByRole('button', { name: '放弃草稿', exact: true }).click()
  await page.locator('.confirmation-dialog').getByRole('button', { name: '放弃草稿', exact: true }).click()
  await box(page).waitFor()
  assert.equal(await editor(page).count(), 0)
  assert.equal((await drafts(page)).length, 10)
  assert.equal(await version(page), savedVersion)
  // Fault injection: a second writer updates a real encrypted record while the discard confirmation is open.
  const outdated = (await drafts(page))[0]
  await box(page).locator(`[data-draft-id="${outdated.id}"]`).getByRole('button', { name: '放弃草稿', exact: true }).click()
  await page.evaluate(async ({ record, master }) => {
    const snapshot = await (await fetch('/api/v1/vault')).json()
    const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
    const { putVaultDraft } = await import('/src/modules/vault/draft-store.ts')
    const worker = new VaultWorker()
    try {
      await worker.request({ kind: 'unlock', password: master, envelope: snapshot.envelope, id: snapshot.vaultId })
      const opened = await worker.request({ kind: 'open-draft', envelope: record.envelope })
      if (opened.kind !== 'opened-draft') throw new Error('Expected actual saved draft')
      opened.draft.entry.name = 'M3_SECURE_FAKE_BOX_UPDATED_WHILE_CONFIRMING'
      const sealed = await worker.request({ kind: 'draft', draft: opened.draft })
      if (sealed.kind !== 'draft') throw new Error('Expected actual updated ciphertext')
      await putVaultDraft({ ...record, updatedAt: new Date().toISOString(), envelope: sealed.envelope })
    } finally { worker.lock() }
  }, { record: outdated, master })
  await page.locator('.confirmation-dialog').getByRole('button', { name: '放弃草稿', exact: true }).click()
  await box(page).getByText('M3_SECURE_FAKE_BOX_UPDATED_WHILE_CONFIRMING', { exact: true }).waitFor()
  assert.equal((await drafts(page)).length, 10)
  assert.equal(await version(page), savedVersion)
  await page.getByRole('button', { name: '关闭草稿箱', exact: true }).click()
  await page.getByRole('button', { name: '立即锁定', exact: true }).click()
  assert.ok(!(await page.locator('body').innerText()).includes('M3_SECURE_FAKE_BOX_'))
  await page.getByLabel('保险库主密码', { exact: true }).fill(master)
  await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
  await page.reload()
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '密码保险库', exact: true }).click()
  await page.getByLabel('保险库主密码', { exact: true }).fill(master)
  await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
  await openDraftBox(page)
  assert.equal(await rows(page).count(), 10)
  assert.ok(!JSON.stringify(await drafts(page)).includes('M3_SECURE_FAKE_BOX_'))
  await page.getByRole('button', { name: '关闭草稿箱', exact: true }).click()
}
