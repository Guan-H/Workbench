import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const phase = process.argv[2], output = process.env.SESSIONS_OUTPUT, port = Number(process.env.SESSIONS_FRONTEND_PORT), backend = process.env.SESSIONS_BACKEND
assert.ok(['recovery', 'recovery-restart'].includes(phase) && output && port)
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const master = 'M3_FAKE_MASTER_for_vault_foundation_only', replacement = 'RECOVERY_FAKE_NEW_MASTER_20261109'
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [vue()], logLevel: 'error', optimizeDeps: { include: ['libsodium-wrappers-sumo'] },
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: output + '/browser-a.json' })
  page = await context.newPage()
  const errors = [], requests = [], dialogs = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss() })
  page.on('request', request => requests.push({ url: request.url(), body: request.postData() ?? '' }))
  await page.goto(`http://127.0.0.1:${port}`)
  const nav = page.getByRole('navigation', { name: '主要导航' }), box = page.locator('.vault-recovery-dialog')
  const read = async route => (await (await page.request.get(`http://127.0.0.1:${port}/api/v1/${route ?? 'vault'}`)).json())
  async function unlock(password) {
    await page.getByLabel('保险库主密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
    await page.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
  }
  async function generate(password) {
    await page.getByRole('button', { name: '设置恢复密钥', exact: true }).click()
    await box.getByLabel('当前保险库主密码', { exact: true }).fill(password)
    await box.getByRole('button', { name: '生成恢复密钥', exact: true }).click()
    await box.getByRole('button', { name: '下载恢复密钥', exact: true }).waitFor()
    const download = page.waitForEvent('download')
    await box.getByRole('button', { name: '下载恢复密钥', exact: true }).click()
    const saved = await download, path = await saved.path(), text = await readFile(path, 'utf8')
    const match = text.match(/(?:[0-9A-F]{8}-){7}[0-9A-F]{8}/)
    assert.ok(match, 'Actual downloaded file must contain the generated test key')
    await box.getByRole('checkbox', { name: '我已将恢复密钥保存在可信离线位置', exact: true }).check()
    assert.ok(!(await box.locator('textarea').inputValue()).includes(match[0]))
    return match[0]
  }
  async function confirmKey(secret) {
    await box.getByLabel('重新输入恢复密钥', { exact: true }).fill(secret)
    await box.getByRole('checkbox', { name: '确认启用此密钥；如已有恢复密钥，将替换当前恢复入口。', exact: true }).check()
    await box.getByRole('button', { name: '确认启用恢复密钥', exact: true }).click()
    await box.waitFor({ state: 'detached' })
  }
  async function resetForm(secret, newPassword = replacement) {
    await box.getByLabel('恢复密钥', { exact: true }).fill(secret)
    await box.getByLabel('新保险库主密码', { exact: true }).fill(newPassword)
    await box.getByLabel('再次输入新保险库主密码', { exact: true }).fill(newPassword)
    await box.getByRole('checkbox', { name: '我已保管新主密码，确认重置并保留原有内容。', exact: true }).check()
    await box.getByRole('button', { name: '确认重置主密码', exact: true }).click()
  }
  async function openReset() { await page.getByRole('button', { name: '忘记主密码？使用恢复密钥', exact: true }).click(); await box.getByLabel('恢复密钥', { exact: true }).waitFor() }
  async function raw(route, body, operation = crypto.randomUUID()) {
    return page.evaluate(async ({ route, body, operation }) => {
      const { api } = await import('/src/shared/api/client.ts')
      try { return { status: 200, body: await api(route, { method: 'PUT', headers: { 'Idempotency-Key': operation }, body: JSON.stringify(body) }) } }
      catch (error) { return { status: error.status, code: error.code } }
    }, { route, body, operation })
  }
  await nav.getByRole('button', { name: '密码保险库', exact: true }).click()
  if (phase === 'recovery') {
    assert.equal((await read('vault/recovery')).enabled, false)
    await page.getByRole('button', { name: '忘记主密码？使用恢复密钥', exact: true }).click()
    await box.getByText('没有可用的恢复设置', { exact: true }).waitFor(); await box.getByRole('button', { name: '关闭', exact: true }).click()
    const seeded = await page.evaluate(async master => {
      const { api, write } = await import('/src/shared/api/client.ts'), { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      const { putVaultDraft } = await import('/src/modules/vault/draft-store.ts')
      let snapshot = await api('/vault'); const worker = new VaultWorker()
      try {
        await worker.request({ kind: 'unlock', password: master, envelope: snapshot.envelope, id: snapshot.vaultId })
        const now = new Date().toISOString(), common = { tags: [], favorite: false, createdAt: now, updatedAt: now }
        const entry = { ...common, id: crypto.randomUUID(), type: 'login', name: 'RECOVERY_FAKE_LOGIN', urls: [], username: '', password: 'RECOVERY_FAKE_CONTENT', notes: '', fields: [] }
        const note = { ...common, id: crypto.randomUUID(), type: 'secure-note', name: 'RECOVERY_FAKE_DELETED', body: 'RECOVERY_FAKE_BODY', deletedAt: now }
        const sealed = await worker.request({ kind: 'seal', content: { format: 'private-space-vault-content', version: 1, entries: [entry, note] } })
        snapshot = await write('/vault', 'PUT', { baseVersion: snapshot.version, envelope: sealed.envelope }); await worker.request({ kind: 'adopt', envelope: snapshot.envelope })
        const draft = await worker.request({ kind: 'draft', draft: { format: 'private-space-vault-draft-content', version: 1, baseVersion: snapshot.version, entry: { ...entry, password: 'RECOVERY_FAKE_DRAFT' }, original: entry } })
        await putVaultDraft({ id: entry.id, vaultId: snapshot.vaultId, updatedAt: now, envelope: draft.envelope })
        return snapshot
      } finally { worker.lock() }
    }, master)
    await page.reload(); await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await unlock(master)
    await page.getByRole('button', { name: '设置恢复密钥', exact: true }).click()
    await box.getByLabel('当前保险库主密码', { exact: true }).fill('RECOVERY_FAKE_WRONG_MASTER')
    await box.getByRole('button', { name: '生成恢复密钥', exact: true }).click()
    await box.getByRole('alert').filter({ hasText: '当前主密码核验失败' }).waitFor()
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    const canceled = await generate(master)
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    assert.deepEqual(await read(), seeded); assert.equal((await read('vault/recovery')).enabled, false)
    const mismatched = await generate(master)
    await box.getByLabel('重新输入恢复密钥', { exact: true }).fill(mismatched.slice(0, -1) + (mismatched.endsWith('0') ? '1' : '0'))
    await box.getByRole('checkbox', { name: '确认启用此密钥；如已有恢复密钥，将替换当前恢复入口。', exact: true }).check()
    await box.getByRole('button', { name: '确认启用恢复密钥', exact: true }).click()
    await box.getByRole('alert').filter({ hasText: '密钥核对失败' }).waitFor()
    assert.equal((await read('vault/recovery')).enabled, false)
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    const secret = await generate(master)
    assert.notEqual(secret, canceled)
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 850 }); await box.getByRole('heading', { name: '设置恢复密钥', exact: true }).hover()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + `/recovery-setup-${width}.png`, fullPage: true }); await box.evaluate(el => { el.scrollTop = el.scrollHeight }); await page.screenshot({ path: output + `/recovery-setup-bottom-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await confirmKey(secret)
    const enabled = await read(), policy = await read('vault/recovery')
    assert.deepEqual(enabled.envelope, seeded.envelope); assert.equal(policy.enabled, true)
    await openReset(); await resetForm(canceled)
    await box.getByRole('alert').filter({ hasText: '恢复密钥不正确' }).waitFor()
    assert.deepEqual(await read(), enabled)
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    await openReset()
    let committed = false
    await page.route('**/api/v1/vault/recovery/reset-master-password', async route => {
      if (route.request().method() !== 'PUT' || committed) { await route.continue(); return }
      const response = await route.fetch(); assert.equal(response.status(), 200); committed = true; await route.abort('failed')
    })
    await resetForm(secret)
    await box.getByText('有一份恢复密钥操作尚待确认', { exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.vault-recovery-dialog button.ant-btn-loading'))
    assert.ok(committed)
    const pending = await page.evaluate(async () => (await import('/src/modules/vault/recovery-store.ts')).readRecoveryRequest('sessions-it'))
    assert.ok(!JSON.stringify(pending).includes(secret)); assert.equal(pending.mode, 'reset-master')
    await writeFile(output + '/recovery-reset-request.json', JSON.stringify(pending))
    await page.unroute('**/api/v1/vault/recovery/reset-master-password'); await page.reload()
    await nav.getByRole('button', { name: '密码保险库', exact: true }).click()
    await page.getByRole('button', { name: '核对恢复操作', exact: true }).click()
    await box.getByRole('button', { name: '重试确认恢复操作', exact: true }).click(); await box.waitFor({ state: 'detached' })
    const recovered = await read()
    assert.equal(recovered.version, String(BigInt(enabled.version) + 1n)); assert.deepEqual(recovered.envelope.payload, enabled.envelope.payload)
    assert.notDeepEqual(recovered.envelope.wrappedKey, enabled.envelope.wrappedKey)
    assert.equal((await raw('/vault/recovery/reset-master-password', { baseVersion: pending.baseVersion, recoveryId: pending.recoveryId, envelope: pending.envelope }, pending.operation)).status, 200)
    await page.getByLabel('保险库主密码', { exact: true }).fill(master); await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '无法解锁' }).waitFor(); await unlock(replacement)
    await page.getByText('RECOVERY_FAKE_LOGIN', { exact: true }).first().waitFor()
    const checks = await page.evaluate(async ({ replacement, historyVersion }) => {
      const { api } = await import('/src/shared/api/client.ts'), { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      const { listVaultDrafts } = await import('/src/modules/vault/draft-store.ts')
      const current = await api('/vault'), worker = new VaultWorker()
      try {
        const opened = await worker.request({ kind: 'unlock', password: replacement, envelope: current.envelope, id: current.vaultId })
        const previous = await api('/vault/history/' + historyVersion), historical = await worker.request({ kind: 'inspect', envelope: previous.envelope })
        const drafts = await listVaultDrafts(current.vaultId), draft = await worker.request({ kind: 'open-draft', envelope: drafts[0].envelope })
        return { content: opened.entries[0].password === 'RECOVERY_FAKE_CONTENT', trash: !!opened.entries[1].deletedAt,
          history: historical.entries[0].password === 'RECOVERY_FAKE_CONTENT', draft: draft.draft.entry.password === 'RECOVERY_FAKE_DRAFT' }
      } finally { worker.lock() }
    }, { replacement, historyVersion: seeded.version })
    assert.deepEqual(checks, { content: true, trash: true, history: true, draft: true })
    // A stale setup must not replace the active key; the real version precondition is enforced by the server.
    const stale = { baseVersion: seeded.version, envelope: seeded.envelope, recovery: policy.recovery }
    assert.ok([400, 409].includes((await raw('/vault/recovery', stale)).status))
    const second = await generate(replacement); await confirmKey(second)
    await openReset(); await resetForm(secret)
    await box.getByRole('alert').filter({ hasText: '恢复密钥不正确' }).waitFor()
    await box.getByRole('button', { name: '关闭', exact: true }).click(); await openReset()
    const beforeFinal = await read()
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 850 }); await box.getByRole('heading', { name: '重置保险库主密码', exact: true }).hover()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + `/recovery-reset-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await resetForm(second, replacement + '_again'); await box.waitFor({ state: 'detached' })
    assert.equal((await read()).version, String(BigInt(beforeFinal.version) + 1n))
    await writeFile(output + '/recovery-test-fixture.json', JSON.stringify({ secret: second, password: replacement + '_again', oldPolicy: policy, oldRequest: pending }))
    assert.ok(requests.every(request => !request.body.includes(secret) && !request.body.includes(second)))
  } else {
    const fixture = JSON.parse(await readFile(output + '/recovery-test-fixture.json', 'utf8')), before = await read()
    await unlock(fixture.password)
    await page.getByText('RECOVERY_FAKE_LOGIN', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: '立即锁定', exact: true }).click(); await openReset()
    await resetForm(fixture.secret, replacement + '_after_restart'); await box.waitFor({ state: 'detached' }); await unlock(replacement + '_after_restart')
    const after = await read()
    assert.deepEqual(after.envelope.payload, before.envelope.payload)
    const malformed = structuredClone(after.envelope); malformed.payload.ciphertext = malformed.payload.ciphertext.slice(0, -2) + 'AA'
    const policy = await read('vault/recovery')
    assert.equal((await raw('/vault/recovery/reset-master-password', { baseVersion: after.version, recoveryId: policy.recovery.id, envelope: malformed })).status, 400)
    assert.equal((await raw('/vault/recovery/reset-master-password', { baseVersion: fixture.oldRequest.baseVersion, recoveryId: fixture.oldRequest.recoveryId, envelope: fixture.oldRequest.envelope }, fixture.oldRequest.operation)).status, 409)
    assert.deepEqual(await read(), after)
    const rollback = await page.evaluate(async ({ password, secret }) => {
      const { api } = await import('/src/shared/api/client.ts'), { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      const saved = await api('/vault'), policy = await api('/vault/recovery'), worker = new VaultWorker()
      try {
        await worker.request({ kind: 'unlock', password, envelope: saved.envelope, id: saved.vaultId })
        const generated = await worker.request({ kind: 'recovery-generate', currentPassword: password })
        const configured = await worker.request({ kind: 'recovery-confirm', token: generated.token, secret: generated.secret })
        const reset = await worker.request({ kind: 'recovery-reset', envelope: saved.envelope, recovery: policy.recovery, secret, newPassword: password + '_rollback_only' })
        return { baseVersion: saved.version, envelope: saved.envelope, recovery: configured.recovery, operation: crypto.randomUUID(), resetEnvelope: reset.envelope, recoveryId: policy.recovery.id }
      } finally { worker.lock() }
    }, { password: replacement + '_after_restart', secret: fixture.secret })
    await writeFile(output + '/recovery-rollback.json', JSON.stringify(rollback))
    assert.ok(requests.every(request => !request.body.includes(fixture.secret)))
  }
  const anonymous = await browser.newContext()
  assert.equal((await anonymous.request.get(`http://127.0.0.1:${port}/api/v1/vault/recovery`)).status(), 401)
  await anonymous.close()
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, [])
  assert.ok(requests.every(request => !request.body.includes('RECOVERY_FAKE_') && !request.body.includes(master)))
  console.log('PASS: account-sessions-' + phase + ', real UI/Worker/HTTP/MySQL; no plaintext recovery key in requests')
} catch (error) { if (page) await page.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => {}); throw error }
finally { if (browser) await browser.close(); await server.close() }
