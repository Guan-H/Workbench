import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { checkCalendarInteractions } from './check-calendar-interactions.mjs'
import { checkPasswordGenerator } from './check-password-generator.mjs'
import { checkVaultFoundation } from './check-vault-foundation.mjs'
import { checkMarkdownLinebreaks } from './check-markdown-linebreaks.mjs'
import { prepareSessionExpiryCheck } from './check-session-expiry.mjs'

const phase = process.argv[2]
const backend = process.env.SESSIONS_BACKEND
const port = Number(process.env.SESSIONS_FRONTEND_PORT)
const output = process.env.SESSIONS_OUTPUT
const password = process.env.SESSIONS_PASSWORD
assert.ok(['write', 'restore'].includes(phase) && output && password)
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const server = await createServer({ configFile: false, plugins: [vue()], root: fileURLToPath(new URL('../', import.meta.url)),
  logLevel: 'error', optimizeDeps: { include: ['libsodium-wrappers-sumo'] }, server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page
try {
  await server.listen()
  const origin = `http://127.0.0.1:${port}`
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
    ...(phase === 'restore' ? { storageState: output + '/browser-a.json' } : {}) })
  if (phase === 'write') await context.addCookies([{ name: 'PRIVATE_SPACE_SESSION', value: process.env.SESSIONS_LEGACY_TOKEN,
    domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict', secure: false }])
  page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  if (phase === 'write' && process.env.CHECK_MARKDOWN_LINEBREAKS === '1') await checkMarkdownLinebreaks(page, output)
  if (phase === 'write' && process.env.CHECK_CALENDAR_INTERACTIONS === '1') await checkCalendarInteractions(page, output)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '账户设置', exact: true }).waitFor()
  if (process.env.CHECK_VAULT_FOUNDATION === '1') await checkVaultFoundation(page, output, phase)
  if (phase === 'write' && process.env.CHECK_PASSWORD_GENERATOR === '1') await checkPasswordGenerator(page, output)
  const panel = page.locator('.account-sessions')
  const rows = page.locator('[data-login-session]')
  const list = async () => {
    const response = await context.request.get(origin + '/api/v1/auth/sessions')
    assert.equal(response.status(), 200)
    const sessions = await response.json()
    for (const session of sessions) {
      assert.deepEqual(Object.keys(session).sort(), ['createdAt', 'current', 'expiresAt', 'id'])
      assert.match(session.id, /^[\da-f-]{36}$/)
    }
    assert.equal(sessions.filter(session => session.current).length, 1)
    return sessions
  }
  async function request(path, method = 'GET', body) {
    return page.evaluate(async ({ path, method, body }) => {
      const { api } = await import('/src/shared/api/client.ts')
      try { return { status: 200, body: await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }) } }
      catch (error) { return { status: error.status, code: error.code } }
    }, { path, method, body })
  }
  async function count(expected) {
    await page.waitForFunction(value => document.querySelectorAll('[data-login-session]').length === value, expected)
  }
  if (phase === 'write') {
    await count(1)
    const legacyId = (await list())[0].id
    assert.ok(Math.abs(Date.parse((await list())[0].createdAt) - Date.now()) < 60000, 'UTC timestamps retain the actual server time')
    assert.equal(await rows.first().getByRole('button').isDisabled(), true)
    const other = await browser.newContext()
    const third = await browser.newContext()
    async function login(target) {
      const loginPage = await target.newPage()
      await loginPage.goto(origin)
      await loginPage.getByLabel('用户名', { exact: true }).fill('sessions-it')
      await loginPage.getByLabel('登录口令', { exact: true }).fill(password)
      await loginPage.getByRole('button', { name: '进入私有空间', exact: true }).click()
      await loginPage.getByRole('heading', { name: '工作台', exact: true }).waitFor()
    }
    await login(other); await login(third)
    const checkExpiry = process.env.CHECK_SESSION_EXPIRY === '1' ? await prepareSessionExpiryCheck(other.pages()[0], password, output) : undefined
    const otherId = (await (await other.request.get(origin + '/api/v1/auth/sessions')).json()).find(session => session.current).id
    const thirdId = (await (await third.request.get(origin + '/api/v1/auth/sessions')).json()).find(session => session.current).id
    await page.getByRole('button', { name: '刷新会话', exact: true }).click(); await count(3)
    assert.deepEqual(await request('/auth/sessions/' + legacyId, 'DELETE'), { status: 409, code: 'CURRENT_SESSION' })
    assert.equal((await request('/auth/sessions/invalid', 'DELETE')).status, 400)
    const revoke = page.getByRole('button', { name: '撤销会话 ' + otherId, exact: true })
    await revoke.click()
    const dialog = page.getByRole('dialog', { name: '撤销登录会话', exact: true })
    await dialog.click({ position: { x: 2, y: 2 } })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await other.request.get(origin + '/api/v1/notes')).status(), 200)
    await revoke.click(); await dialog.getByRole('button', { name: '确认撤销', exact: true }).click(); await count(2)
    assert.equal((await other.request.get(origin + '/api/v1/notes')).status(), 401)
    if (checkExpiry) await checkExpiry().catch(async error => {
      await other.pages()[0].screenshot({ path: output + '/session-expiry-failure.png', fullPage: true }).catch(() => {})
      throw error
    })
    assert.equal((await third.request.get(origin + '/api/v1/notes')).status(), 200)
    assert.deepEqual(await request('/auth/sessions/' + otherId, 'DELETE'), { status: 200, body: { revoked: 0 } })
    const forbidden = await page.evaluate(async id => (await fetch('/api/v1/auth/sessions/' + id, { method: 'DELETE' })).status, thirdId)
    assert.equal(forbidden, 403)
    const { token } = await (await context.request.get(origin + '/api/v1/auth/csrf')).json()
    assert.equal((await context.request.delete(origin + '/api/v1/auth/sessions/' + thirdId,
      { headers: { Origin: 'https://blocked.example', 'X-CSRF-TOKEN': token } })).status(), 403)
    const anonymous = await browser.newContext()
    assert.equal((await anonymous.request.get(origin + '/api/v1/auth/sessions')).status(), 401)
    const pairing = await request('/sync-devices/pairing-code', 'POST', { name: '会话权限隔离验收' })
    const device = await request('/sync/pair', 'POST', { code: pairing.body.code })
    assert.equal(device.status, 200)
    const headers = { Authorization: 'Bearer ' + device.body.token }
    assert.equal((await anonymous.request.get(origin + '/api/v1/auth/sessions', { headers })).status(), 401)
    assert.equal((await anonymous.request.get(origin + '/api/v1/vault', { headers })).status(), 401)
    const syncCsrf = await (await anonymous.request.get(origin + '/api/v1/auth/csrf')).json()
    assert.equal((await anonymous.request.put(origin + '/api/v1/vault/master-password', {
      headers: { ...headers, Origin: origin, 'X-CSRF-TOKEN': syncCsrf.token, 'Idempotency-Key': crypto.randomUUID() },
      data: { baseVersion: '1', envelope: {} },
    })).status(), 401)
    assert.equal((await anonymous.request.put(origin + '/api/v1/vault', {
      headers: { ...headers, Origin: origin, 'X-CSRF-TOKEN': syncCsrf.token, 'Idempotency-Key': crypto.randomUUID() },
      data: { baseVersion: '1', envelope: {} },
    })).status(), 401)
    assert.equal((await anonymous.request.get(origin + '/api/v1/sync/snapshot', { headers })).status(), 200)
    await anonymous.close()
    // More real successful logins create independently persisted sessions for pagination.
    const thirdPage = third.pages()[0]
    for (let index = 0; index < 11; index++) await thirdPage.evaluate(async value => {
      const { api } = await import('/src/shared/api/client.ts')
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'sessions-it', password: value }) })
    }, password)
    const expiredId = (await (await third.request.get(origin + '/api/v1/auth/sessions')).json()).find(session => session.current).id
    await page.getByRole('button', { name: '刷新会话', exact: true }).click(); await count(10)
    assert.equal((await list()).length, 13)
    const pagination = page.getByRole('navigation', { name: '登录会话分页', exact: true })
    await pagination.getByText('共 2 页', { exact: false }).waitFor()
    for (const [width, height] of [[1440, 900], [375, 700]]) {
      await page.setViewportSize({ width, height }); await panel.scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + '/sessions-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await pagination.getByRole('button', { name: '下一页', exact: true }).click(); await count(3)
    await pagination.getByRole('button', { name: '上一页', exact: true }).click(); await count(10)
    await context.storageState({ path: output + '/browser-a.json' })
    await other.storageState({ path: output + '/browser-b.json' })
    await third.storageState({ path: output + '/browser-c.json' })
    await writeFile(output + '/state.json', JSON.stringify({ legacyId, revokedId: otherId, expiredId, count: 13 }))
    await other.close(); await third.close()
  } else {
    const state = JSON.parse(await readFile(output + '/state.json', 'utf8'))
    await count(10)
    const sessions = await list()
    assert.equal(sessions.length, 12)
    assert.equal(sessions.find(session => session.current).id, state.legacyId)
    assert.ok(sessions.every(session => session.id !== state.revokedId && session.id !== state.expiredId))
    for (const name of ['b', 'c']) {
      const invalid = await browser.newContext({ storageState: output + '/browser-' + name + '.json' })
      assert.equal((await invalid.request.get(origin + '/api/v1/notes')).status(), 401)
      await invalid.close()
    }
    assert.equal((await context.request.get(origin + '/api/v1/notes')).status(), 200)
  }
  assert.deepEqual(errors, [])
  console.log('PASS: account-sessions-' + phase)
} catch (error) {
  if (page) await page.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => {})
  throw error
} finally { if (browser) await browser.close(); await server.close() }
