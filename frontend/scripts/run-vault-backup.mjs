import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const phase = process.argv[2]
const output = process.env.SESSIONS_OUTPUT
const port = Number(process.env.SESSIONS_FRONTEND_PORT)
const backend = process.env.SESSIONS_BACKEND
assert.ok(['backup', 'backup-new', 'backup-new-restore'].includes(phase) && output && port)
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const master = 'M3_FAKE_MASTER_for_vault_foundation_only'
const backupPassword = 'BACKUP_FAKE_INDEPENDENT_PASSWORD'
const newMaster = 'BACKUP_FAKE_NEW_INSTANCE_MASTER'
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [vue()], logLevel: 'error',
  optimizeDeps: { include: ['libsodium-wrappers-sumo'] }, server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page
const requests = [], errors = []
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: output + '/browser-a.json' })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' }))
  await page.goto(`http://127.0.0.1:${port}`)
  const nav = page.getByRole('navigation', { name: '主要导航' })
  const box = page.locator('.vault-backup-dialog')
  const read = async () => {
    const response = await page.request.get(`http://127.0.0.1:${port}/api/v1/vault`)
    assert.equal(response.status(), 200); return response.json()
  }
  async function unlock(password) {
    await page.getByLabel('保险库主密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
    await page.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
  }
  async function modal() { await page.getByRole('button', { name: '备份与恢复', exact: true }).click(); await box.getByText('仅备份服务器已保存的当前整库', { exact: false }).waitFor() }
  async function choose(file = output + '/vault-backup.json', password = backupPassword) {
    if (await box.getByText('恢复备份', { exact: true }).count()) await box.getByText('恢复备份', { exact: true }).click()
    await box.locator('#backup-file').setInputFiles(file)
    await box.getByLabel('备份口令', { exact: true }).fill(password)
    await box.getByRole('button', { name: '解密并预检', exact: true }).click()
  }
  async function preview() { await box.getByRole('heading', { name: '恢复预览', exact: true }).waitFor(); await box.getByRole('checkbox').check() }
  async function mutate(seed = false) {
    return page.evaluate(async ({ master, seed }) => {
      const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      const { api, write } = await import('/src/shared/api/client.ts')
      const snapshot = await api('/vault')
      const worker = new VaultWorker()
      try {
        const result = await worker.request({ kind: 'unlock', password: master, envelope: snapshot.envelope, id: snapshot.vaultId })
        if (result.kind !== 'unlocked') throw new Error('Real test unlock failed')
        const now = new Date().toISOString()
        const fields = { tags: [], favorite: false, createdAt: now, updatedAt: now }
        const entries = seed ? [
          { ...fields, id: crypto.randomUUID(), type: 'login', name: 'BACKUP_FAKE_LOGIN', icon: 'google', urls: [], username: '', password: 'BACKUP_FAKE_SECRET', notes: '', fields: [] },
          { ...fields, id: crypto.randomUUID(), type: 'secure-note', name: 'BACKUP_FAKE_NOTE', body: '# BACKUP_FAKE_MARKDOWN' },
          { ...fields, id: crypto.randomUUID(), type: 'secure-note', name: 'BACKUP_FAKE_TRASH', body: 'BACKUP_FAKE_DELETED', deletedAt: now },
        ] : result.entries.map(item => ({ ...item, tags: ['BACKUP_FAKE_NEWER'] }))
        const sealed = await worker.request({ kind: 'seal', content: { format: 'private-space-vault-content', version: 1, entries } })
        if (sealed.kind !== 'sealed') throw new Error('Real test seal failed')
        return write('/vault', 'PUT', { baseVersion: snapshot.version, envelope: sealed.envelope })
      } finally { worker.lock() }
    }, { master, seed })
  }
  if (phase === 'backup') {
    await mutate(true)
    const source = await read()
    await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await unlock(master)
    await modal()
    await box.getByLabel('核验当前主密码').fill(master + '-wrong')
    await box.getByLabel('独立备份口令').fill(backupPassword)
    await box.getByLabel('确认备份口令').fill(backupPassword)
    await box.getByRole('button', { name: '生成加密备份', exact: true }).click()
    await box.getByRole('alert').filter({ hasText: '主密码无法核验' }).waitFor()
    assert.deepEqual(await read(), source)
    await box.getByLabel('核验当前主密码').fill(master)
    await box.getByLabel('独立备份口令').fill(backupPassword)
    await box.getByLabel('确认备份口令').fill(backupPassword)
    const download = page.waitForEvent('download')
    await box.getByRole('button', { name: '生成加密备份', exact: true }).click()
    await (await download).saveAs(output + '/vault-backup.json')
    await box.waitFor({ state: 'detached' })
    const text = await readFile(output + '/vault-backup.json', 'utf8')
    assert.ok(!text.includes('BACKUP_FAKE_') && !text.includes(master))
    const backup = JSON.parse(text)
    assert.equal(backup.format, 'private-space-vault-backup'); assert.equal(backup.envelope.purpose, 'backup')
    for (const key of ['vaultId', 'keyId']) assert.notEqual(backup.envelope[key], source.envelope[key])
    assert.notEqual(backup.envelope.kdf.salt, source.envelope.kdf.salt)
    await modal(); await choose(undefined, backupPassword + '-wrong')
    await box.getByRole('alert').filter({ hasText: '备份口令不正确' }).waitFor()
    assert.deepEqual(await read(), source)
    const mutated = structuredClone(backup); mutated.envelope.kdf.memory = 1073741824
    await choose({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(mutated)) })
    await box.getByRole('alert').filter({ hasText: '备份口令不正确' }).waitFor()
    assert.deepEqual(await read(), source)
    await choose(); await preview()
    assert.ok(!(await box.innerText()).includes('BACKUP_FAKE_'), 'Preview must expose counts, not decrypted fields')
    await box.getByText('共 3 项', { exact: false }).waitFor()
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    assert.deepEqual(await read(), source)
    await modal(); await choose(); await preview()
    await mutate()
    const newer = await read()
    await box.getByRole('button', { name: '确认恢复', exact: true }).click()
    await box.getByRole('alert').filter({ hasText: '服务器保险库已变化' }).waitFor()
    assert.deepEqual(await read(), newer)
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    await page.reload(); await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await unlock(master)
    await modal(); await choose(); await preview()
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 800 }); await box.getByRole('heading', { name: '恢复预览', exact: true }).hover()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + '/vault-backup-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    let committed = false
    await page.route('**/api/v1/vault', async route => {
      if (route.request().method() !== 'PUT' || committed) { await route.continue(); return }
      const response = await route.fetch(); assert.equal(response.status(), 200); committed = true; await route.abort('failed')
    })
    await box.getByRole('button', { name: '确认恢复', exact: true }).click()
    await box.getByText('有一份恢复请求尚待确认', { exact: true }).waitFor()
    await box.getByRole('button', { name: '重试确认恢复', exact: true }).waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('.vault-backup-dialog button.ant-btn-loading'))
    assert.ok(committed)
    const restored = await read()
    assert.equal(restored.version, String(BigInt(newer.version) + 1n))
    assert.deepEqual(restored.envelope.wrappedKey, source.envelope.wrappedKey)
    const queued = await page.evaluate(async () => { const { readRestore } = await import('/src/modules/vault/restore-store.ts'); return readRestore('sessions-it') })
    assert.ok(queued && !JSON.stringify(queued).includes('BACKUP_FAKE_'))
    await page.unroute('**/api/v1/vault')
    await page.reload(); await nav.getByRole('button', { name: '密码保险库', exact: true }).click()
    await page.getByRole('button', { name: '恢复结果待确认', exact: true }).click()
    await box.getByRole('button', { name: '重试确认恢复', exact: true }).click()
    await box.waitFor({ state: 'detached' }); await unlock(master)
    assert.equal((await read()).version, restored.version, 'Acknowledgement retry cannot add another history version')
    await page.getByText('BACKUP_FAKE_LOGIN', { exact: true }).first().waitFor()
    assert.equal(await page.evaluate(async () => { const { readRestore } = await import('/src/modules/vault/restore-store.ts'); return !!await readRestore('sessions-it') }), false)
  } else {
    await nav.getByRole('button', { name: '密码保险库', exact: true }).click()
    if (phase === 'backup-new') {
      assert.equal((await read()).initialized, false, 'Recovery target is a genuinely empty, separate database')
      await modal(); await choose(); await preview()
      await box.getByLabel('恢复后的新主密码').fill(newMaster)
      await box.getByLabel('确认新主密码').fill(newMaster)
      await box.getByRole('button', { name: '确认恢复', exact: true }).click()
      await box.waitFor({ state: 'detached' })
      const saved = await read()
      assert.equal(saved.version, '1')
      const backup = JSON.parse(await readFile(output + '/vault-backup.json', 'utf8'))
      assert.notEqual(saved.envelope.vaultId, backup.envelope.vaultId); assert.notEqual(saved.envelope.keyId, backup.envelope.keyId)
    }
    await unlock(newMaster)
    await page.getByText('BACKUP_FAKE_LOGIN', { exact: true }).first().click()
    assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), 'BACKUP_FAKE_SECRET')
    await page.getByText('BACKUP_FAKE_NOTE', { exact: true }).first().click()
    await page.getByRole('region', { name: '安全笔记预览', exact: true }).getByText('BACKUP_FAKE_MARKDOWN', { exact: true }).waitFor()
    await page.getByRole('menuitem', { name: /保险库回收站/ }).click()
    await page.getByText('BACKUP_FAKE_TRASH', { exact: true }).first().waitFor()
  }
  assert.deepEqual(errors, [])
  assert.ok(requests.every(request => !request.body.includes('BACKUP_FAKE_') && !request.body.includes(master) && !request.body.includes('"icon":') && !request.url.includes('BACKUP_FAKE_')))
  assert.equal(requests.filter(request => /\/api\/v1\/(notes|files|note-imports)/.test(request.url)).filter(request => request.method !== 'GET').length, 0)
  console.log('PASS: account-sessions-' + phase)
} catch (error) {
  if (page) await page.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => {})
  throw error
} finally { if (browser) await browser.close(); await server.close() }
