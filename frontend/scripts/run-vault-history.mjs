import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const phase = process.argv[2], output = process.env.SESSIONS_OUTPUT, port = Number(process.env.SESSIONS_FRONTEND_PORT), backend = process.env.SESSIONS_BACKEND
assert.ok(['history', 'history-restore'].includes(phase) && output && port)
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const master = 'M3_FAKE_MASTER_for_vault_foundation_only', currentMaster = 'HISTORY_FAKE_CHANGED_MASTER_20261109'
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
  const nav = page.getByRole('navigation', { name: '主要导航' }), history = page.locator('.vault-history-dialog'), box = page.locator('.vault-backup-dialog')
  const read = async () => (await (await page.request.get(`http://127.0.0.1:${port}/api/v1/vault`)).json())
  async function unlock() {
    await page.getByLabel('保险库主密码', { exact: true }).fill(currentMaster)
    await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
    await page.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
  }
  async function seedOrAdvance(seed) {
    return page.evaluate(async ({ master, currentMaster, seed }) => {
      const { api, write } = await import('/src/shared/api/client.ts')
      const { VaultWorker } = await import('/src/modules/vault/worker-client.ts')
      let snapshot = await api('/vault')
      const policy = await api('/vault/retention'), worker = new VaultWorker()
      try {
        const opened = await worker.request({ kind: 'unlock', password: seed ? master : currentMaster, envelope: snapshot.envelope, id: snapshot.vaultId })
        if (opened.kind !== 'unlocked') throw new Error('Real seed unlock failed')
        const now = new Date(policy.serverTime).toISOString(), old = new Date(Date.parse(policy.trashCutoff) - 86400000).toISOString()
        const common = { tags: [], favorite: false, createdAt: now, updatedAt: now }
        let entries = seed ? [
          { ...common, id: crypto.randomUUID(), type: 'login', name: 'HISTORY_FAKE_LOGIN_0', urls: [], username: '', password: 'HISTORY_FAKE_PASSWORD', notes: '', fields: [] },
          { ...common, id: crypto.randomUUID(), type: 'secure-note', name: 'HISTORY_FAKE_NOTE', body: '<img src="https://example.invalid/leak" onerror="window.HISTORY_FAKE_XSS=1">\n[x](javascript:alert(1))\n![x](https://example.invalid/leak)' },
          ...Array.from({ length: 11 }, (_, i) => ({ ...common, id: crypto.randomUUID(), type: 'secure-note', name: `HISTORY_FAKE_EXPIRED_${i}`, body: 'HISTORY_FAKE_DELETED_BODY', deletedAt: old })),
          { ...common, id: crypto.randomUUID(), type: 'secure-note', name: 'HISTORY_FAKE_RECENT', body: '', deletedAt: now },
          { ...common, id: crypto.randomUUID(), type: 'secure-note', name: 'HISTORY_FAKE_FUTURE', body: '', deletedAt: '2100-01-01T00:00:00.000Z' },
        ] : opened.entries.map(item => ({ ...item, tags: ['HISTORY_FAKE_NEWER'] }))
        for (let index = 0; index < (seed ? 11 : 1); index++) {
          if (seed) entries = entries.map((item, i) => i ? item : { ...item, name: `HISTORY_FAKE_LOGIN_${index}` })
          const sealed = await worker.request({ kind: 'seal', content: { format: 'private-space-vault-content', version: 1, entries } })
          if (sealed.kind !== 'sealed') throw new Error('Real seed seal failed')
          snapshot = await write('/vault', 'PUT', { baseVersion: snapshot.version, envelope: sealed.envelope })
          await worker.request({ kind: 'adopt', envelope: snapshot.envelope })
        }
        if (seed) {
          const changed = await worker.request({ kind: 'rewrap', currentPassword: master, newPassword: currentMaster })
          if (changed.kind !== 'rewrapped') throw new Error('Real master rewrap failed')
          snapshot = await write('/vault/master-password', 'PUT', { baseVersion: snapshot.version, envelope: changed.envelope })
        }
        return snapshot
      } finally { worker.lock() }
    }, { master, currentMaster, seed })
  }
  async function openOld() {
    await page.getByRole('button', { name: '历史版本', exact: true }).click()
    await history.getByRole('navigation', { name: '保险库历史分页' }).getByRole('button', { name: '下一页' }).click()
    await history.locator('.vault-history-versions button').filter({ hasText: /版本 2(?:\D|$)/ }).click()
    await history.getByRole('heading', { name: '版本 2 · 只读内容' }).waitFor()
  }
  async function chooseOldRestore() { await openOld(); await history.getByRole('button', { name: '恢复此版本', exact: true }).click(); await box.getByRole('heading', { name: '恢复预览', exact: true }).waitFor() }
  async function cleanupPreview() { await page.getByRole('button', { name: '预检过期条目', exact: true }).click(); await box.getByRole('heading', { name: '清理预检', exact: true }).waitFor() }

  if (phase === 'history') {
    const source = await seedOrAdvance(true)
    const response = await page.request.get(`http://127.0.0.1:${port}/api/v1/vault/history`)
    assert.ok(response.headers()['cache-control'].includes('no-store'))
    const listing = await response.json()
    assert.equal(listing.items.length, 10); assert.equal(listing.total, 13)
    for (const item of listing.items) assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'operationKind', 'version'])
    assert.equal((await page.request.get(`http://127.0.0.1:${port}/api/v1/vault/history/0`)).status(), 400)
    assert.equal((await page.request.get(`http://127.0.0.1:${port}/api/v1/vault/history/999999`)).status(), 404)
    const anonymous = await browser.newContext()
    for (const route of ['history', 'history/2', 'retention']) assert.equal((await anonymous.request.get(`http://127.0.0.1:${port}/api/v1/vault/${route}`)).status(), 401)
    await anonymous.close()
    await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await unlock()
    await openOld()
    await history.getByRole('button', { name: 'HISTORY_FAKE_LOGIN_0', exact: true }).click()
    assert.equal(await history.getByLabel('密码', { exact: true }).inputValue(), 'HISTORY_FAKE_PASSWORD')
    await history.getByRole('button', { name: 'HISTORY_FAKE_NOTE', exact: true }).click()
    assert.equal(await history.locator('script, img, a[href^="javascript:"]').count(), 0)
    assert.equal(await page.evaluate(() => window.HISTORY_FAKE_XSS), undefined)
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 850 })
      await history.getByRole('heading', { name: '保险库历史版本', exact: true }).hover()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + `/history-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await history.getByRole('button', { name: '恢复此版本', exact: true }).click()
    await box.getByRole('heading', { name: '恢复预览', exact: true }).waitFor()
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    assert.deepEqual(await read(), source)
    await chooseOldRestore()
    const newer = await seedOrAdvance(false)
    await box.getByRole('checkbox').check(); await box.getByRole('button', { name: '确认恢复', exact: true }).click()
    await box.getByRole('alert').filter({ hasText: '服务器保险库已变化' }).waitFor()
    assert.deepEqual(await read(), newer)
    await box.getByRole('button', { name: '关闭', exact: true }).click()
    await page.reload(); await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await unlock()
    await chooseOldRestore(); await box.getByRole('checkbox').check(); await box.getByRole('button', { name: '确认恢复', exact: true }).click()
    await box.waitFor({ state: 'detached' }); await unlock()
    const restored = await read()
    assert.equal(restored.version, String(BigInt(newer.version) + 1n)); assert.deepEqual(restored.envelope.wrappedKey, source.envelope.wrappedKey)
    await page.getByRole('button', { name: '历史版本', exact: true }).click()
    await history.getByRole('heading', { name: '保险库历史版本', exact: true }).waitFor()
    await page.clock.install(); await page.clock.fastForward(301000)
    await page.getByRole('heading', { name: '保险库已锁定', exact: true }).waitFor(); await page.clock.resume()
    assert.equal(await history.count(), 0)
    await unlock(); await cleanupPreview()
    await box.getByText('待清理 11 项', { exact: true }).waitFor()
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 850 }); await box.getByRole('heading', { name: '清理预检', exact: true }).hover()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + `/cleanup-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.equal(await box.locator('.vault-cleanup-items li').count(), 10)
    await box.getByRole('button', { name: '下一页' }).click(); assert.equal(await box.locator('.vault-cleanup-items li').count(), 1)
    await box.getByRole('button', { name: '关闭', exact: true }).click(); assert.deepEqual(await read(), restored)
    await cleanupPreview()
    let committed = false
    await page.route('**/api/v1/vault', async route => {
      if (route.request().method() !== 'PUT' || committed) { await route.continue(); return }
      const response = await route.fetch(); assert.equal(response.status(), 200); committed = true; await route.abort('failed')
    })
    await box.getByRole('checkbox').check(); await box.getByRole('button', { name: '确认清理', exact: true }).click()
    await box.getByText('有一份清理请求尚待确认', { exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.vault-backup-dialog button.ant-btn-loading'))
    assert.ok(committed)
    const queued = await page.evaluate(async () => { const { readRestore } = await import('/src/modules/vault/restore-store.ts'); return readRestore('sessions-it') })
    assert.equal(queued.source, 'cleanup'); assert.ok(!JSON.stringify(queued).includes('HISTORY_FAKE_'))
    await writeFile(output + '/history-final-request.json', JSON.stringify(queued))
    await page.unroute('**/api/v1/vault'); await page.reload(); await nav.getByRole('button', { name: '密码保险库', exact: true }).click()
    await page.getByRole('button', { name: '清理结果待确认', exact: true }).click(); await box.getByRole('button', { name: '重试确认清理', exact: true }).click()
    await box.waitFor({ state: 'detached' }); await unlock()
    assert.equal(await page.getByRole('button', { name: '预检过期条目', exact: true }).count(), 0)
    await page.getByRole('menuitem', { name: /保险库回收站/ }).click()
    await page.getByText('HISTORY_FAKE_RECENT', { exact: true }).waitFor(); await page.getByText('HISTORY_FAKE_FUTURE', { exact: true }).waitFor()
    assert.equal(await page.getByText('HISTORY_FAKE_EXPIRED_0', { exact: true }).count(), 0)
  } else {
    await nav.getByRole('button', { name: '密码保险库', exact: true }).click(); await unlock()
    const candidate = JSON.parse(await readFile(output + '/history-final-request.json', 'utf8'))
    const before = await read()
    const retry = await page.evaluate(async candidate => {
      const { api } = await import('/src/shared/api/client.ts')
      return api('/vault', { method: 'PUT', headers: { 'Idempotency-Key': candidate.operation }, body: JSON.stringify({ baseVersion: candidate.baseVersion, envelope: candidate.envelope }) })
    }, candidate)
    assert.deepEqual(retry, before)
    const listing = await (await page.request.get(`http://127.0.0.1:${port}/api/v1/vault/history`)).json()
    assert.equal(listing.total, 2)
    assert.equal((await page.request.get(`http://127.0.0.1:${port}/api/v1/vault/history/1`)).status(), 404)
    await page.getByRole('button', { name: '历史版本', exact: true }).click()
    await history.locator('.vault-history-versions button').filter({ hasText: /版本 2(?:\D|$)/ }).click()
    await history.getByRole('button', { name: 'HISTORY_FAKE_LOGIN_0', exact: true }).click()
    assert.equal(await history.getByLabel('密码', { exact: true }).inputValue(), 'HISTORY_FAKE_PASSWORD')
  }
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, [])
  assert.ok(requests.every(request => !request.url.includes('HISTORY_FAKE_') && !request.body.includes('HISTORY_FAKE_') && !request.body.includes(master)))
  assert.equal(requests.filter(request => /example\.invalid/.test(request.url)).length, 0)
  console.log('PASS: account-sessions-' + phase)
} catch (error) { if (page) await page.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => {}); throw error }
finally { if (browser) await browser.close(); await server.close() }
