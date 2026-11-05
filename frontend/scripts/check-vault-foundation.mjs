import assert from 'node:assert/strict'
import { finalMaster } from './check-vault-master-password.mjs'
import { entriesMaster } from './check-vault-entries.mjs'

const master = 'M3_FAKE_MASTER_for_vault_foundation_only'
export async function checkVaultFoundation(page, output, phase) {
  const requests = []
  const capture = request => { requests.push({ method: request.method(), body: request.postData() ?? '', url: request.url() }) }
  page.on('request', capture)
  const nav = page.getByRole('navigation', { name: '主要导航' })
  const locked = page.getByRole('heading', { name: '保险库已锁定', exact: true })
  const unlocked = page.getByRole('heading', { name: '保险库已解锁', exact: true })
  const read = async () => {
    const response = await page.request.get(new URL('/api/v1/vault', page.url()).href)
    assert.equal(response.status(), 200)
    assert.ok(response.headers()['cache-control'].includes('no-store'))
    return response.json()
  }
  const write = (body, operation = crypto.randomUUID()) => page.evaluate(async ({ body, operation }) => {
    const { api } = await import('/src/shared/api/client.ts')
    try { return { status: 200, body: await api('/vault', { method: 'POST', headers: { 'Idempotency-Key': operation }, body: JSON.stringify(body) }) } }
    catch (error) { return { status: error.status, code: error.code } }
  }, { body, operation })
  async function unlock(password = phase === 'restore' && process.env.CHECK_VAULT_ENTRIES === '1' ? entriesMaster : phase === 'restore' && process.env.CHECK_VAULT_MASTER === '1' ? finalMaster : master) {
    await page.getByLabel('保险库主密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
  }
  try {
    await nav.getByRole('button', { name: '密码保险库', exact: true }).click()
    if (phase === 'write') {
      await page.getByRole('heading', { name: '创建保险库', exact: true }).waitFor()
      assert.equal((await read()).initialized, false)
      await page.getByLabel('保险库主密码', { exact: true }).fill(master)
      await page.getByLabel('再次输入主密码', { exact: true }).fill(master + 'different')
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: '创建加密保险库', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: '两次输入必须一致' }).waitFor()
      assert.equal(requests.filter(request => request.method === 'POST' && request.url.endsWith('/api/v1/vault')).length, 0)
      await page.getByLabel('再次输入主密码', { exact: true }).fill(master)
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await page.screenshot({ path: output + '/vault-create-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      // Real commit, then a lost acknowledgement. Retrying must not create another snapshot/history row.
      let committed = false
      const endpoint = '**/api/v1/vault'
      const loseAcknowledgement = async route => {
        if (route.request().method() !== 'POST' || committed) { await route.continue(); return }
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        committed = true
        await route.abort('failed')
      }
      await page.route(endpoint, loseAcknowledgement)
      await page.getByRole('button', { name: '创建加密保险库', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: '创建结果尚未确认' }).waitFor({ timeout: 40000 })
      assert.ok(committed && (await read()).initialized)
      await page.unroute(endpoint, loseAcknowledgement)
      await page.getByRole('button', { name: '重试确认创建', exact: true }).click()
      await locked.waitFor()
      const snapshot = await read()
      const envelope = snapshot.envelope
      assert.equal(envelope.format, 'private-space-vault')
      assert.equal(snapshot.version, '1')
      assert.ok(!JSON.stringify(snapshot).includes(master))
      for (const mutated of [
        { ...envelope, format: 'private-space-candidate' },
        { ...envelope, password: 'M3_FAKE_PLAINTEXT_FIELD' },
        { ...envelope, kdf: { ...envelope.kdf, memory: 1073741824 } },
      ]) assert.equal((await write({ envelope: mutated })).status, 400)
      assert.equal((await write({ envelope, password: 'M3_FAKE_PLAINTEXT_FIELD' })).status, 400)
      assert.equal((await write({ envelope })).status, 409)
      const anonymous = await page.context().browser().newContext()
      try { assert.equal((await anonymous.request.get(new URL('/api/v1/vault', page.url()).href)).status(), 401) }
      finally { await anonymous.close() }
      const badCsrf = await page.evaluate(async envelope => (await fetch('/api/v1/vault', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ envelope }) })).status, envelope)
      assert.equal(badCsrf, 403)
      // Tamper genuine ciphertext/metadata only; run the production Worker and keep server data untouched.
      const rejected = await page.evaluate(async ({ envelope, master }) => {
        const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
        const flip = value => (value[0] === 'A' ? 'B' : 'A') + value.slice(1)
        const variants = [
          { ...envelope, wrappedKey: { ...envelope.wrappedKey, ciphertext: flip(envelope.wrappedKey.ciphertext) } },
          { ...envelope, payload: { ...envelope.payload, ciphertext: flip(envelope.payload.ciphertext) } },
          { ...envelope, payload: { ...envelope.payload, nonce: flip(envelope.payload.nonce) } },
          { ...envelope, keyId: crypto.randomUUID() },
          { ...envelope, kdf: { ...envelope.kdf, memory: 1073741824 } },
        ]
        const results = []
        for (const candidate of variants) {
          const worker = new VaultWorker()
          try { await worker.request({ kind: 'unlock', password: master, envelope: candidate, id: envelope.vaultId }); results.push(false) }
          catch { results.push(true) }
          finally { worker.lock() }
        }
        return results
      }, { envelope, master })
      assert.deepEqual(rejected, [true, true, true, true, true])
      assert.deepEqual(await read(), snapshot)
      await unlock(master + 'wrong')
      await page.getByRole('alert').filter({ hasText: '无法解锁' }).waitFor()
      await locked.waitFor()
      assert.deepEqual(await read(), snapshot)
      await unlock(); await unlocked.waitFor()
      assert.equal(await page.locator('input[type=password]').count(), 0)
      await page.getByRole('button', { name: '立即锁定', exact: true }).click(); await locked.waitFor()
      await unlock(); await unlocked.waitFor()
      // Browser clock advancement verifies five-minute UI inactivity without simulating cryptography or HTTP.
      await page.clock.install()
      await page.clock.fastForward(301000)
      await locked.waitFor()
      await page.clock.resume()
      await unlock(); await unlocked.waitFor()
      await nav.getByRole('button', { name: '工作台', exact: true }).click()
      await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await locked.waitFor()
      await unlock(); await unlocked.waitFor()
      await page.reload()
      await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await locked.waitFor()
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await page.screenshot({ path: output + '/vault-locked-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    } else { await locked.waitFor(); await unlock(); await unlocked.waitFor() }
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    assert.ok(!storage.includes(master))
    assert.ok(requests.every(request => !request.url.includes(master) && !request.body.includes(master)))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('heading', { name: '账户设置', exact: true }).waitFor()
  } finally { page.off('request', capture) }
}
