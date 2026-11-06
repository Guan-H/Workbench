import assert from 'node:assert/strict'
import { recoverFirstDraft } from './vault-draft-box-helpers.mjs'

/** Revoke a real login, retain actual local drafts, and authenticate again without fake HTTP responses. */
export async function prepareSessionExpiryCheck(page, password, output) {
  const origin = new URL(page.url()).origin
  const path = '登录失效草稿验证.md'
  const draft = 'SESSION_EXPIRY_FAKE_UNSAVED_CONTENT'
  const call = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
    const { api } = await import('/src/shared/api/client.ts')
    try { return { status: 200, body: await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }) } }
    catch (error) { return { status: error.status } }
  }, { path, method, body })
  const note = await page.evaluate(async path => {
    const { write } = await import('/src/shared/api/client.ts')
    return write('/notes', 'POST', { path, type: 'note', content: '服务器原文' })
  }, path)
  await page.goto(origin + '/?note=' + encodeURIComponent(path))
  const editor = page.getByTestId('markdown-editor')
  await editor.waitFor()
  async function login(value = password) {
    await page.getByLabel('用户名', { exact: true }).fill('sessions-it')
    await page.getByLabel('登录口令', { exact: true }).fill(value)
    await page.getByRole('button', { name: '进入私有空间', exact: true }).click()
  }
  const loginHeading = page.getByRole('heading', { name: '欢迎回来', exact: true })
  return async () => {
    // Hold a genuine server 401 until after the next successful login.
    let release, arrived
    const gate = new Promise(resolve => { release = resolve })
    const received = new Promise(resolve => { arrived = resolve })
    const endpoint = '**/api/v1/notes?query=late-expiry'
    await page.route(endpoint, async route => {
      const response = await route.fetch()
      assert.equal(response.status(), 401)
      arrived()
      await gate
      await route.fulfill({ response })
    })
    const late = call('/notes?query=late-expiry').catch(error => ({ status: 'transport-error', message: error.message }))
    await received
    await editor.fill(draft)
    const failures = await page.evaluate(async () => {
      const { api, apiResponse } = await import('/src/shared/api/client.ts')
      return Promise.all([
        api('/notes'), api('/sync-devices'),
        apiResponse('/note-exports', { method: 'POST', body: JSON.stringify({ all: true, ids: [] }) }),
      ].map(task => task.then(() => 200, error => error.status)))
    })
    assert.deepEqual(failures, [401, 401, 401])
    await loginHeading.waitFor()
    await page.getByText('登录已失效，请重新登录。', { exact: true }).waitFor()
    assert.equal(await editor.count(), 0)
    const stored = await page.evaluate(id => JSON.parse(localStorage.getItem(`private-space:draft:sessions-it:${id}`)), note.id)
    assert.equal(stored.text, draft)
    await page.screenshot({ path: output + '/session-expired-login.png', fullPage: true })
    await login(password + '-wrong')
    await page.locator('.auth-form [role=alert]').waitFor()
    await loginHeading.waitFor()
    await login()
    await page.getByRole('navigation', { name: '主要导航', exact: true }).waitFor()
    release()
    assert.equal((await late).status, 401)
    await page.unroute(endpoint)
    assert.equal(await loginHeading.count(), 0, 'An old 401 cannot invalidate the new login')
    const persisted = await (await page.request.get(origin + '/api/v1/notes/' + note.id)).json()
    assert.equal(persisted.content, '服务器原文', 'No expired request saved the local draft')
    await page.goto(origin + '/?note=' + encodeURIComponent(path))
    await editor.waitFor()
    await editor.getByText(draft, { exact: true }).waitFor()
    assert.equal(await editor.innerText(), draft)

    if (process.env.CHECK_VAULT_FOUNDATION === '1') {
      const master = 'M3_FAKE_MASTER_for_vault_foundation_only'
      const name = 'SESSION_EXPIRY_FAKE_VAULT_DRAFT'
      await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '密码保险库', exact: true }).click()
      await page.getByLabel('保险库主密码', { exact: true }).fill(master)
      await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
      await page.getByRole('button', { name: '新增登录条目', exact: true }).click()
      await page.getByLabel('条目名称', { exact: true }).fill(name)
      const vaultId = (await (await page.request.get(origin + '/api/v1/vault')).json()).vaultId
      assert.equal((await call('/auth/logout', 'POST')).status, 200)
      assert.equal(await page.evaluate(async () => {
        const { uploadRequest } = await import('/src/shared/api/client.ts')
        try { await uploadRequest('/note-imports/preview', new FormData(), () => {}); return 200 }
        catch (error) { return error.status }
      }), 401)
      await loginHeading.waitFor()
      assert.equal(await page.getByLabel('条目名称', { exact: true }).count(), 0)
      assert.ok(!(await page.locator('body').innerText()).includes(name))
      const drafts = await page.evaluate(async id => {
        const { listVaultDrafts } = await import('/src/modules/vault/draft-store.ts')
        return listVaultDrafts(id)
      }, vaultId)
      assert.equal(drafts.length, 1)
      assert.ok(!JSON.stringify(drafts).includes(name), 'IndexedDB retains ciphertext only')
      await login()
      await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '密码保险库', exact: true }).click()
      await page.getByRole('heading', { name: '保险库已锁定', exact: true }).waitFor()
      await page.getByLabel('保险库主密码', { exact: true }).fill(master)
      await page.getByRole('button', { name: '解锁保险库', exact: true }).click()
      await page.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
      await recoverFirstDraft(page)
      assert.equal(await page.getByLabel('条目名称', { exact: true }).inputValue(), name)
    }
    // Remove the temporary replacement session; preserve the account suite's session count.
    assert.equal((await call('/auth/logout', 'POST')).status, 200)
    assert.equal((await call('/notes')).status, 401)
    await loginHeading.waitFor()
    console.log('PASS: session-expiry redirect, real parallel 401/export, wrong password, late response, ordinary draft and encrypted vault draft')
  }
}
