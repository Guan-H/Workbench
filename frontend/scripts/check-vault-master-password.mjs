import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const originalMaster = 'M3_FAKE_MASTER_for_vault_foundation_only'
const changedMaster = 'M3_FAKE_MASTER_changed_once_only'
export const finalMaster = 'M3_FAKE_MASTER_after_concurrent_change_only'

export async function checkVaultMasterPassword(page, output) {
  const secrets = [originalMaster, changedMaster, finalMaster]
  const requests = []
  const capture = request => requests.push({ url: request.url(), body: request.postData() ?? '', method: request.method() })
  page.on('request', capture)
  const locked = page.getByRole('heading', { name: '保险库已锁定', exact: true })
  const unlocked = page.getByRole('heading', { name: '保险库已解锁', exact: true })
  const nav = page.getByRole('navigation', { name: '主要导航' })
  const read = async () => {
    const response = await page.request.get(new URL('/api/v1/vault', page.url()).href)
    assert.equal(response.status(), 200)
    return response.json()
  }
  const request = (body, operation = crypto.randomUUID()) => page.evaluate(async ({ body, operation }) => {
    const { api } = await import('/src/shared/api/client.ts')
    try { return { status: 200, body: await api('/vault/master-password', { method: 'PUT', headers: { 'Idempotency-Key': operation }, body: JSON.stringify(body) }) } }
    catch (error) { return { status: error.status, code: error.code } }
  }, { body, operation })
  async function unlock(password, target = page) {
    await target.getByLabel('保险库主密码', { exact: true }).fill(password)
    await target.getByRole('button', { name: '解锁保险库', exact: true }).click()
  }
  async function fillChange(currentPassword, newPassword, target = page) {
    await target.getByRole('button', { name: '修改主密码', exact: true }).click()
    await target.getByLabel('当前主密码', { exact: true }).fill(currentPassword)
    await target.getByLabel('新主密码', { exact: true }).fill(newPassword)
    await target.getByLabel('再次输入新主密码', { exact: true }).fill(newPassword)
    await target.getByRole('checkbox', { name: '我已妥善保管新主密码，并确认修改。', exact: true }).check()
  }
  async function prepare(source, password, newPassword) {
    return page.evaluate(async ({ source, password, newPassword }) => {
      const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      const worker = new VaultWorker()
      try {
        await worker.request({ kind: 'unlock', password, envelope: source.envelope, id: source.vaultId })
        const result = await worker.request({ kind: 'rewrap', currentPassword: password, newPassword })
        if (result.kind !== 'rewrapped') throw new Error('Expected a ciphertext wrapper')
        return { baseVersion: source.version, envelope: result.envelope }
      } finally { worker.lock() }
    }, { source, password, newPassword })
  }
  let stalePage
  try {
    await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await locked.waitFor()
    const initial = await read()
    assert.equal(initial.version, '1')
    await unlock(originalMaster); await unlocked.waitFor()
    await fillChange(originalMaster, changedMaster)
    await page.getByLabel('再次输入新主密码', { exact: true }).fill(changedMaster + 'different')
    await page.getByRole('button', { name: '确认修改主密码', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '两次输入一致' }).waitFor()
    assert.equal(requests.filter(item => item.method === 'PUT').length, 0)
    await page.getByLabel('再次输入新主密码', { exact: true }).fill(changedMaster)
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + '/vault-master-dialog-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.mouse.click(5, 5)
    await page.getByLabel('当前主密码', { exact: true }).waitFor()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await page.locator('input[type=password]').count(), 0)
    await fillChange(originalMaster, changedMaster)
    await page.clock.install()
    await page.clock.fastForward(301000)
    await locked.waitFor()
    assert.equal(await page.getByLabel('当前主密码', { exact: true }).count(), 0)
    assert.equal(await page.getByLabel('保险库主密码', { exact: true }).inputValue(), '')
    await page.clock.resume()
    await unlock(originalMaster); await unlocked.waitFor()
    await fillChange(originalMaster + 'wrong', changedMaster)
    await page.getByRole('button', { name: '确认修改主密码', exact: true }).click()
    await locked.waitFor()
    await page.getByRole('alert').filter({ hasText: '未提交修改' }).waitFor()
    assert.equal(requests.filter(item => item.method === 'PUT').length, 0)
    assert.deepEqual(await read(), initial)
    await unlock(originalMaster); await unlocked.waitFor()
    await fillChange(originalMaster, changedMaster)
    // Commit to the real database, then discard only the acknowledgement.
    let acknowledgedBody, acknowledgedOperation
    const loseAcknowledgement = async route => {
      const response = await route.fetch()
      assert.equal(response.status(), 200)
      acknowledgedBody = route.request().postDataJSON()
      acknowledgedOperation = route.request().headers()['idempotency-key']
      await route.abort('failed')
    }
    await page.route('**/api/v1/vault/master-password', loseAcknowledgement)
    await page.getByRole('button', { name: '确认修改主密码', exact: true }).click()
    await locked.waitFor()
    await page.getByRole('alert').filter({ hasText: '主密码修改结果尚未确认' }).waitFor({ timeout: 40000 })
    await page.unroute('**/api/v1/vault/master-password', loseAcknowledgement)
    assert.equal((await read()).version, '2')
    await page.getByRole('button', { name: '重试确认主密码修改', exact: true }).click()
    await page.getByLabel('保险库主密码', { exact: true }).waitFor()
    const second = await read()
    assert.equal(second.version, '2')
    assert.equal(second.vaultId, initial.vaultId)
    assert.equal(second.envelope.keyId, initial.envelope.keyId)
    assert.deepEqual(second.envelope.payload, initial.envelope.payload)
    assert.notEqual(second.envelope.kdf.salt, initial.envelope.kdf.salt)
    assert.notEqual(second.envelope.wrappedKey.nonce, initial.envelope.wrappedKey.nonce)
    await unlock(originalMaster)
    await page.getByRole('alert').filter({ hasText: '无法解锁' }).waitFor()
    await unlock(changedMaster); await unlocked.waitFor()

    const candidate = await prepare(second, changedMaster, finalMaster)
    assert.equal((await request(candidate, acknowledgedOperation)).status, 409)
    const badPayload = { ...candidate, envelope: { ...candidate.envelope, payload: { ...candidate.envelope.payload, id: crypto.randomUUID() } } }
    assert.equal((await request(badPayload)).status, 400)
    assert.equal((await request({ ...candidate, password: 'M3_FAKE_PLAINTEXT_FIELD' })).status, 400)
    assert.equal((await request({ ...candidate, envelope: { ...candidate.envelope, keyId: crypto.randomUUID() } })).status, 400)
    assert.equal((await request({ ...candidate, envelope: second.envelope })).status, 400)
    assert.equal((await request({ ...candidate, baseVersion: '01' })).status, 400)
    const csrf = await page.evaluate(async body => (await fetch('/api/v1/vault/master-password', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) })).status, candidate)
    assert.equal(csrf, 403)
    assert.deepEqual(await read(), second)

    stalePage = await page.context().newPage()
    await stalePage.goto(new URL('/', page.url()).href)
    await stalePage.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '密码保险库', exact: true }).click()
    await stalePage.getByRole('heading', { name: '保险库已锁定', exact: true }).waitFor()
    await unlock(changedMaster, stalePage)
    await stalePage.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
    const otherCandidate = await prepare(second, changedMaster, finalMaster)
    const concurrent = await Promise.all([request(candidate), request(otherCandidate)])
    assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409])
    const third = await read()
    assert.equal(third.version, '3')
    assert.deepEqual(third.envelope.payload, initial.envelope.payload)
    assert.equal((await request(acknowledgedBody, acknowledgedOperation)).status, 409, 'An old committed operation must not report stale success')
    await fillChange(changedMaster, finalMaster + 'stale', stalePage)
    await stalePage.getByRole('button', { name: '确认修改主密码', exact: true }).click()
    await stalePage.getByRole('alert').filter({ hasText: '保险库版本已变化' }).waitFor()
    await stalePage.getByRole('heading', { name: '保险库已锁定', exact: true }).waitFor()
    assert.deepEqual(await read(), third)
    await page.getByRole('button', { name: '立即锁定', exact: true }).click(); await locked.waitFor()
    await unlock(changedMaster)
    await page.getByRole('alert').filter({ hasText: '无法解锁' }).waitFor()
    await unlock(finalMaster); await unlocked.waitFor()

    // A genuine candidate for the Java fixture's real SQL failure/transaction rollback check.
    const rollbackCandidate = await prepare(third, finalMaster, finalMaster + 'rollback-only')
    await writeFile(output + '/vault-rollback-candidate.json', JSON.stringify({ ...rollbackCandidate, operation: crypto.randomUUID() }))
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    assert.ok(secrets.every(secret => !storage.includes(secret)))
    assert.ok(requests.every(item => secrets.every(secret => !item.url.includes(secret) && !item.body.includes(secret))))
    await page.getByRole('button', { name: '立即锁定', exact: true }).click(); await locked.waitFor()
    await page.screenshot({ path: output + '/vault-master-complete.png', fullPage: true })
  } finally {
    if (stalePage) await stalePage.close()
    page.off('request', capture)
  }
}
