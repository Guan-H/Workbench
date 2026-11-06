import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { finalMaster } from './check-vault-master-password.mjs'
import { checkVaultLayout } from './check-vault-layout.mjs'
import { recoverFirstDraft } from './vault-draft-box-helpers.mjs'

export const entriesMaster = finalMaster + '_entries'
const name = 'M3_ENTRY_FAKE_LOGIN'
const username = 'M3_ENTRY_FAKE_USERNAME'
const password = 'M3_ENTRY_FAKE_PASSWORD_only'
const hidden = 'M3_ENTRY_FAKE_HIDDEN_only'
const notes = 'M3_ENTRY_FAKE_NOTE'

export async function checkVaultEntries(page, output) {
  const captured = []
  const secrets = [name, username, password, hidden, notes, finalMaster, entriesMaster]
  const capture = request => captured.push({ method: request.method(), url: request.url(), body: request.postData() ?? '' })
  page.context().on('request', capture)
  const locked = target => target.getByRole('heading', { name: '保险库已锁定', exact: true })
  const unlocked = target => target.getByRole('heading', { name: '保险库已解锁', exact: true })
  const editor = target => target.locator('.vault-entry-detail form')
  const nav = target => target.getByRole('navigation', { name: '主要导航' })
  const read = async () => (await (await page.request.get(new URL('/api/v1/vault', page.url()).href)).json())
  const recordList = async () => page.evaluate(async vaultId => (await import('/src/modules/vault/draft-store.ts')).listVaultDrafts(vaultId), (await read()).vaultId)
  async function unlock(target = page, master = finalMaster) {
    await target.getByLabel('保险库主密码', { exact: true }).fill(master)
    await target.getByRole('button', { name: '解锁保险库', exact: true }).click(); await unlocked(target).waitFor()
  }
  async function vault(target = page) { await nav(target).getByRole('button', { name: '密码保险库', exact: true }).click(); await locked(target).waitFor() }
  async function stored(target = page) { await target.locator('.vault-entry-detail [role=status]').filter({ hasText: '草稿已加密暂存' }).waitFor() }
  async function recover(target = page) { await recoverFirstDraft(target) }
  async function select(target = page, title = name) { await target.locator('.vault-entry-row').filter({ hasText: title }).click() }
  async function edit(target = page) { await select(target); await target.getByRole('button', { name: '编辑条目', exact: true }).click() }
  async function save(target = page) { await target.getByRole('button', { name: '保存条目', exact: true }).click(); await editor(target).waitFor({ state: 'detached' }) }
  async function mutateWithWorker(master, mutation) {
    const snapshot = await read()
    return page.evaluate(async ({ snapshot, master, mutation }) => {
      const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      const { newEntry } = await import('/src/modules/vault/entries.ts')
      const worker = new VaultWorker()
      try {
        const opened = await worker.request({ kind: 'unlock', password: master, envelope: snapshot.envelope, id: snapshot.vaultId })
        if (opened.kind !== 'unlocked') throw new Error('Expected genuine decrypted entries')
        const entries = opened.entries
        if (mutation === 'pages') for (let index = 0; index < 11; index++) entries.push({ ...newEntry(), name: 'M3_PAGINATION_' + String(index).padStart(2, '0') })
        else entries[0].notes = 'M3_ENTRY_FAKE_ROLLBACK_CANDIDATE'
        const result = await worker.request({ kind: 'seal', content: { format: 'private-space-vault-content', version: 1, entries } })
        if (result.kind !== 'sealed') throw new Error('Expected ciphertext')
        return { baseVersion: snapshot.version, envelope: result.envelope, operation: crypto.randomUUID() }
      } finally { worker.lock() }
    }, { snapshot, master, mutation })
  }
  let stalePage
  try {
    await page.clock.install()
    await vault(); await unlock()
    const initialVersion = BigInt((await read()).version)
    await page.getByRole('button', { name: '新增登录条目', exact: true }).click()
    await page.getByLabel('条目名称', { exact: true }).fill(name)
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '生成 20 位密码', exact: true }).click()
    const generated = await page.getByLabel('密码', { exact: true }).inputValue()
    assert.ok(generated.length === 20 && generated !== password, 'Generator should fill a fresh draft value')
    secrets.push(generated)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByLabel('备注', { exact: true }).fill(notes)
    await page.getByRole('button', { name: '添加网址', exact: true }).click()
    await page.getByLabel('网址 1', { exact: true }).fill('https://example.invalid/vault-test')
    await page.getByRole('button', { name: '添加标签', exact: true }).click()
    await page.getByLabel('标签 1', { exact: true }).fill('验证')
    await page.getByRole('checkbox', { name: '收藏此条目', exact: true }).check()
    await page.getByRole('button', { name: '添加自定义字段', exact: true }).click()
    await page.getByLabel('字段名称 1', { exact: true }).fill('测试隐藏字段')
    await page.getByLabel('字段值 1', { exact: true }).fill(hidden)
    await page.getByRole('checkbox', { name: '隐藏字段 1', exact: true }).check()
    await stored()
    await checkVaultLayout(page, output, 'editor')
    assert.ok((await recordList()).length === 1)
    const encryptedRecords = JSON.stringify(await recordList())
    assert.ok(secrets.every(secret => !encryptedRecords.includes(secret)), 'Draft records must contain only encrypted fields')
    const draftEnvelope = (await recordList())[0].envelope
    assert.equal(draftEnvelope.purpose, 'draft')
    const rejectedDraft = await page.evaluate(async ({ envelope, version }) => {
      const { api } = await import('/src/shared/api/client.ts')
      try { await api('/vault', { method: 'PUT', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ baseVersion: version, envelope }) }); return 200 }
      catch (error) { return error.status }
    }, { envelope: draftEnvelope, version: String(initialVersion) })
    assert.equal(rejectedDraft, 400)
    assert.equal((await read()).version, String(initialVersion))
    await page.getByLabel('备注', { exact: true }).fill('M3_ENTRY_FAKE_NAVIGATION_LATEST')
    secrets.push('M3_ENTRY_FAKE_NAVIGATION_LATEST')
    await nav(page).getByRole('button', { name: '工作台', exact: true }).click()
    await page.getByRole('heading', { name: '工作台', exact: true }).waitFor()
    await vault(); await unlock(); await recover(); await stored()
    assert.ok(await page.getByLabel('备注', { exact: true }).inputValue() === 'M3_ENTRY_FAKE_NAVIGATION_LATEST')
    await page.getByRole('button', { name: '立即锁定', exact: true }).click(); await locked(page).waitFor()
    assert.equal(await page.getByLabel('条目名称', { exact: true }).count(), 0)
    assert.ok(!(await page.locator('body').innerText()).includes(name))
    await unlock(); await recover(); await stored()
    assert.ok(await page.getByLabel('条目名称', { exact: true }).inputValue() === name)
    assert.ok(await page.getByLabel('密码', { exact: true }).inputValue() === password)
    assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'password')
    await page.clock.fastForward(301000); await locked(page).waitFor()
    assert.equal(await page.getByLabel('条目名称', { exact: true }).count(), 0)
    await unlock(); await recover(); await stored()
    assert.ok(await page.getByLabel('备注', { exact: true }).inputValue() === 'M3_ENTRY_FAKE_NAVIGATION_LATEST')

    // Real commit followed by a lost acknowledgement; reload must recover or confirm exactly that request.
    const loseAcknowledgement = async route => {
      if (route.request().method() !== 'PUT') { await route.continue(); return }
      const response = await route.fetch()
      assert.equal(response.status(), 200)
      await route.abort('failed')
    }
    await page.route('**/api/v1/vault', loseAcknowledgement)
    await page.getByRole('button', { name: '保存条目', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '保存结果尚未确认' }).waitFor({ timeout: 40000 })
    await page.unroute('**/api/v1/vault', loseAcknowledgement)
    assert.ok((await recordList()).some(record => record.pending))
    const committedRequest = (await recordList()).find(record => record.pending).pending
    const crossedOperation = await page.evaluate(async request => {
      const { api } = await import('/src/shared/api/client.ts')
      try { await api('/vault/master-password', { method: 'PUT', headers: { 'Idempotency-Key': request.operation }, body: JSON.stringify({ baseVersion: request.baseVersion, envelope: request.envelope }) }); return 200 }
      catch (error) { return error.status }
    }, committedRequest)
    assert.equal(crossedOperation, 409, 'A content-save operation cannot be replayed as a master-password operation')
    const committedVersion = (await read()).version
    assert.equal(committedVersion, String(initialVersion + 1n))
    await page.reload(); await vault(); await unlock(); await recover()
    await page.getByRole('heading', { name: '登录条目详情', exact: true }).waitFor()
    assert.equal((await read()).version, committedVersion)
    assert.equal((await recordList()).length, 0)
    const url = page.getByRole('link', { name: 'https://example.invalid/vault-test', exact: true })
    assert.equal(await url.getAttribute('target'), '_blank')
    await checkVaultLayout(page, output, 'detail')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
    await page.getByRole('button', { name: '复制密码', exact: true }).click()
    assert.ok(await page.evaluate(() => navigator.clipboard.readText()) === password, 'Actual clipboard should contain the selected test password')
    await page.getByRole('button', { name: '显示密码', exact: true }).click()
    assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'text')
    await page.clock.fastForward(31000)
    assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'password')
    await page.clock.resume()
    await page.getByRole('button', { name: '编辑条目', exact: true }).click()
    await page.getByLabel('备注', { exact: true }).fill('M3_ENTRY_FAKE_EDITED_NOTE')
    secrets.push('M3_ENTRY_FAKE_EDITED_NOTE')
    await page.getByLabel('备注', { exact: true }).press('Control+s')
    await editor(page).waitFor({ state: 'detached' })
    assert.equal((await read()).version, String(initialVersion + 2n))
    // Add another real entry so resolving the first entry can prove it preserves unrelated content.
    await page.getByRole('button', { name: '新增登录条目', exact: true }).click()
    await page.getByLabel('条目名称', { exact: true }).fill('M3_ENTRY_OTHER_UNCHANGED')
    secrets.push('M3_ENTRY_OTHER_UNCHANGED')
    await save()
    stalePage = await page.context().newPage()
    await stalePage.goto(new URL('/', page.url()).href); await vault(stalePage); await unlock(stalePage); await edit(stalePage)
    await stalePage.getByLabel('备注', { exact: true }).fill('M3_ENTRY_FAKE_STALE_NOTE'); await stored(stalePage)
    secrets.push('M3_ENTRY_FAKE_STALE_NOTE', 'M3_ENTRY_FAKE_SERVER_NOTE', 'M3_ENTRY_FAKE_MERGED_NOTE')
    await edit()
    await page.getByLabel('备注', { exact: true }).fill('M3_ENTRY_FAKE_SERVER_NOTE'); await save()
    await stalePage.getByRole('button', { name: '保存条目', exact: true }).click()
    await stalePage.getByRole('alert').filter({ hasText: '服务器版本已变化' }).waitFor()
    await stalePage.getByRole('button', { name: '重新读取并保留草稿', exact: true }).click(); await locked(stalePage).waitFor()
    await unlock(stalePage); await recover(stalePage); await stored(stalePage)
    assert.equal(await stalePage.getByRole('button', { name: '保存条目', exact: true }).isDisabled(), true)
    await stalePage.getByText('查看服务器当前条目', { exact: true }).click()
    await stalePage.getByText('M3_ENTRY_FAKE_SERVER_NOTE', { exact: false }).waitFor()
    await stalePage.getByRole('button', { name: '核对后以当前版本继续编辑', exact: true }).click()
    await stalePage.getByRole('button', { name: '以当前版本继续编辑', exact: true }).click()
    await stalePage.getByLabel('备注', { exact: true }).fill('M3_ENTRY_FAKE_MERGED_NOTE'); await save(stalePage)
    await stalePage.close(); stalePage = undefined
    await page.getByRole('button', { name: '重新读取保险库', exact: true }).click(); await locked(page).waitFor(); await unlock()
    await edit()
    await page.getByLabel('备注', { exact: true }).fill('M3_ENTRY_FAKE_DRAFT_AFTER_REKEY')
    secrets.push('M3_ENTRY_FAKE_DRAFT_AFTER_REKEY')
    await stored()
    await page.getByRole('button', { name: '关闭编辑并保留草稿', exact: true }).click(); await editor(page).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '修改主密码', exact: true }).click()
    await page.getByLabel('当前主密码', { exact: true }).fill(finalMaster)
    await page.getByLabel('新主密码', { exact: true }).fill(entriesMaster)
    await page.getByLabel('再次输入新主密码', { exact: true }).fill(entriesMaster)
    await page.getByRole('checkbox', { name: '我已妥善保管新主密码，并确认修改。', exact: true }).check()
    await page.getByRole('button', { name: '确认修改主密码', exact: true }).click(); await locked(page).waitFor()
    await page.getByLabel('保险库主密码', { exact: true }).waitFor()
    await unlock(page, entriesMaster); await recover(); await stored()
    assert.ok(await page.getByLabel('备注', { exact: true }).inputValue() === 'M3_ENTRY_FAKE_DRAFT_AFTER_REKEY')
    await save()

    const candidate = await mutateWithWorker(entriesMaster, 'pages')
    const inserted = await page.evaluate(async candidate => {
      const { api } = await import('/src/shared/api/client.ts')
      return api('/vault', { method: 'PUT', headers: { 'Idempotency-Key': candidate.operation }, body: JSON.stringify({ baseVersion: candidate.baseVersion, envelope: candidate.envelope }) })
    }, candidate)
    assert.equal(inserted.version, String(BigInt(candidate.baseVersion) + 1n))
    await page.getByRole('button', { name: '重新读取保险库', exact: true }).click(); await locked(page).waitFor(); await unlock(page, entriesMaster)
    await page.locator('.vault-entry-row').first().waitFor()
    const pagination = page.getByRole('navigation', { name: '保险库条目分页', exact: true })
    await pagination.getByText('共 13 条', { exact: false }).waitFor()
    assert.equal(await page.locator('.vault-entry-row').count(), 10)
    assert.ok(await page.locator('.vault-entry-rows').evaluate(element => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto'))
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + '/vault-entries-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await pagination.getByRole('button', { name: '下一页', exact: true }).click()
    assert.equal(await page.locator('.vault-entry-row').count(), 3)
    await page.getByLabel('本地搜索', { exact: true }).fill(name)
    assert.equal(await page.locator('.vault-entry-row').count(), 1)
    await select()
    assert.ok((await page.locator('.vault-entry-detail').innerText()).includes('M3_ENTRY_FAKE_DRAFT_AFTER_REKEY'))
    await page.getByRole('navigation', { name: '保险库分类' }).getByRole('menuitem', { name: /收藏/ }).click()
    assert.equal(await page.locator('.vault-entry-row').count(), 1)
    await page.getByLabel('本地搜索', { exact: true }).fill('')
    const rollbackCandidate = await mutateWithWorker(entriesMaster, 'rollback')
    await writeFile(output + '/vault-entry-rollback-candidate.json', JSON.stringify(rollbackCandidate))
    const snapshot = await read()
    await writeFile(output + '/vault-entry-report.json', JSON.stringify({ version: snapshot.version, entries: 13 }))

    // Explicit storage fault injection, without replacing HTTP or cryptography.
    const writesBeforeFailure = captured.filter(item => item.method === 'PUT' && item.url.endsWith('/api/v1/vault')).length
    await page.evaluate(() => {
      const originalPut = IDBObjectStore.prototype.put
      window.restoreVaultDraftPut = () => { IDBObjectStore.prototype.put = originalPut }
      IDBObjectStore.prototype.put = function (...args) {
        if (this.transaction.db.name === 'private-space-vault-drafts') throw new DOMException('Test quota failure', 'QuotaExceededError')
        return originalPut.apply(this, args)
      }
    })
    await page.getByRole('button', { name: '新增登录条目', exact: true }).click()
    await page.getByLabel('条目名称', { exact: true }).fill('M3_ENTRY_FAKE_QUOTA_INPUT')
    secrets.push('M3_ENTRY_FAKE_QUOTA_INPUT')
    await page.getByRole('alert').filter({ hasText: '本机加密草稿暂存失败' }).waitFor()
    await page.getByRole('button', { name: '保存条目', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '本机加密草稿暂存失败' }).waitFor()
    assert.equal(captured.filter(item => item.method === 'PUT' && item.url.endsWith('/api/v1/vault')).length, writesBeforeFailure)
    await page.getByRole('button', { name: '立即锁定', exact: true }).click(); await locked(page).waitFor()
    await page.getByRole('alert').filter({ hasText: '最新草稿未能确认暂存' }).waitFor()
    await page.evaluate(() => window.restoreVaultDraftPut())
    assert.equal((await read()).version, snapshot.version)
    const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    const persisted = JSON.stringify(await recordList())
    assert.ok(secrets.every(secret => !browserStorage.includes(secret) && !persisted.includes(secret)))
    assert.ok(captured.every(item => secrets.every(secret => !item.body.includes(secret) && !item.url.includes(secret))), 'Secrets must not reach any HTTP request')
  } finally {
    if (stalePage) await stalePage.close()
    page.context().off('request', capture)
  }
}
