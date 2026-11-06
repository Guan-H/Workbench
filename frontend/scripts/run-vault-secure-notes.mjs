import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { checkVaultTrash, checkVaultTrashRestore } from './check-vault-trash.mjs'
import { checkAvatarPicker, checkCustomAvatarPicker, chooseAvatar, resetAvatar } from './check-vault-avatars.mjs'
import { recoverFirstDraft } from './vault-draft-box-helpers.mjs'
import { checkVaultDraftBox } from './check-vault-draft-box.mjs'

const phase = process.argv[2]
const output = process.env.SESSIONS_OUTPUT
const backend = process.env.SESSIONS_BACKEND
const port = Number(process.env.SESSIONS_FRONTEND_PORT)
assert.ok(['secure-notes', 'secure-notes-restore'].includes(phase) && output && port)
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const master = 'M3_FAKE_MASTER_for_vault_foundation_only'
const title = 'M3_SECURE_FAKE_TITLE'
const body = '# M3_SECURE_FAKE_HEADING\n\nM3_SECURE_FAKE_FIRST\nM3_SECURE_FAKE_SECOND\n\n- item\n\n```txt\ncode\n```\n\n![remote](https://example.invalid/M3_SECURE_FAKE_IMAGE.png)\n\n![[M3_SECURE_FAKE_LOCAL.png]]\n\n<img src="/api/v1/files/content?path=M3_SECURE_FAKE_LOCAL.png">\n\n[link](https://example.invalid/test)'
const finalBody = body + '\n\nM3_SECURE_FAKE_MERGED'
const server = await createServer({ configFile: false, plugins: [vue()], root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'error',
  optimizeDeps: { include: ['libsodium-wrappers-sumo'] }, server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page, stale
const requests = []
const errors = []
let customAvatarSource
const nav = target => target.getByRole('navigation', { name: '主要导航' })
const preview = target => target.getByRole('region', { name: '安全笔记预览', exact: true })
const editor = target => target.locator('.vault-entry-detail form')
async function unlock(target) {
  await target.getByLabel('保险库主密码', { exact: true }).fill(master)
  await target.getByRole('button', { name: '解锁保险库', exact: true }).click()
  await target.getByRole('heading', { name: '保险库已解锁', exact: true }).waitFor()
}
async function open(target) { await nav(target).getByRole('button', { name: '密码保险库', exact: true }).click(); await unlock(target) }
async function stored(target) { await target.locator('.vault-entry-detail [role=status]').filter({ hasText: '草稿已加密暂存' }).waitFor() }
async function save(target) { await target.getByRole('button', { name: '保存条目', exact: true }).click(); await editor(target).waitFor({ state: 'detached' }) }
async function select(target) { await target.locator('.vault-entry-row').filter({ hasText: title }).click() }
async function edit(target) { await select(target); await target.getByRole('button', { name: '编辑条目', exact: true }).click() }
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ storageState: output + '/browser-a.json', viewport: { width: 1440, height: 900 } })
  context.on('request', request => requests.push({ url: request.url(), body: request.postData() ?? '', method: request.method() }))
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}`)
  await open(page)
  if (phase === 'secure-notes') {
    // Mix real login and note entries in the same encrypted persisted snapshot.
    await page.getByRole('button', { name: '新增登录条目', exact: true }).click()
    await page.getByLabel('条目名称', { exact: true }).fill('M3_SECURE_FAKE_LOGIN')
    await page.getByLabel('密码', { exact: true }).fill('M3_SECURE_FAKE_PASSWORD')
    if (process.env.CHECK_VAULT_AVATARS === '1') await checkAvatarPicker(page, output)
    await save(page)
    if (process.env.CHECK_VAULT_AVATARS === '1') await page.locator('.vault-entry-detail').getByRole('img', { name: 'X 头像', exact: true }).waitFor()
    await page.getByRole('button', { name: '新建安全笔记', exact: true }).click()
    await page.getByLabel('条目名称', { exact: true }).fill(title)
    if (process.env.CHECK_VAULT_CUSTOM_AVATARS === '1') customAvatarSource = await checkCustomAvatarPicker(page, output)
    else if (process.env.CHECK_VAULT_AVATARS === '1') await chooseAvatar(page, '哔哩哔哩')
    await page.getByLabel('安全笔记正文', { exact: true }).fill(body)
    await page.getByRole('checkbox', { name: '收藏此条目', exact: true }).check()
    await stored(page)
    await page.locator('.vault-secure-note-toolbar').getByText('预览', { exact: true }).click()
    assert.equal(await page.getByRole('radio', { name: '预览', exact: true }).isChecked(), true)
    await preview(page).getByRole('heading', { name: 'M3_SECURE_FAKE_HEADING', exact: true }).waitFor()
    assert.equal(await preview(page).locator('img,script,iframe,object,embed').count(), 0)
    assert.equal(await preview(page).locator('pre code').textContent(), 'code\n')
    const link = preview(page).getByRole('link', { name: 'link', exact: true })
    assert.equal(await link.getAttribute('target'), '_blank')
    assert.equal(await link.getAttribute('referrerpolicy'), 'no-referrer')
    await page.getByRole('button', { name: '立即锁定', exact: true }).click()
    await page.getByRole('heading', { name: '保险库已锁定', exact: true }).waitFor()
    assert.ok(!(await page.locator('body').innerText()).includes(title))
    assert.equal(await page.locator('#vault-secure-body').count(), 0)
    await unlock(page)
    await recoverFirstDraft(page)
    if (process.env.CHECK_VAULT_AVATARS === '1') await page.locator('.vault-avatar-editor').getByRole('img', { name: process.env.CHECK_VAULT_CUSTOM_AVATARS === '1' ? '自定义头像' : '哔哩哔哩 头像', exact: true }).waitFor()
    assert.equal(await page.getByLabel('安全笔记正文', { exact: true }).inputValue(), body)
    await save(page)
    await page.getByLabel('本地搜索', { exact: true }).fill('M3_SECURE_FAKE_SECOND')
    assert.equal(await page.locator('.vault-entry-row').count(), 1)
    await page.getByRole('menuitem', { name: /登录账号/ }).click()
    assert.equal(await page.locator('.vault-entry-row').count(), 0)
    await page.getByRole('menuitem', { name: /安全笔记/ }).click()
    await select(page)
    await page.getByRole('menuitem', { name: /收藏/ }).click()
    assert.equal(await page.locator('.vault-entry-row').count(), 1)
    await page.getByLabel('本地搜索', { exact: true }).fill('')
    // A stale edit is rejected by the actual versioned API and recovered as an encrypted draft.
    stale = await context.newPage()
    stale.on('pageerror', error => errors.push(error.message))
    await stale.goto(page.url()); await open(stale); await edit(stale)
    await stale.getByLabel('安全笔记正文', { exact: true }).fill(finalBody); await stored(stale)
    await edit(page)
    await page.getByLabel('安全笔记正文', { exact: true }).fill(body + '\n\nM3_SECURE_FAKE_SERVER')
    await save(page)
    await stale.getByRole('button', { name: '保存条目', exact: true }).click()
    await stale.getByRole('alert').filter({ hasText: '服务器版本已变化' }).waitFor()
    await stale.getByRole('button', { name: '重新读取并保留草稿', exact: true }).click(); await unlock(stale)
    await recoverFirstDraft(stale); await stored(stale)
    assert.equal(await stale.getByRole('button', { name: '保存条目', exact: true }).isDisabled(), true)
    assert.equal(await stale.getByLabel('安全笔记正文', { exact: true }).inputValue(), finalBody)
    await stale.getByRole('button', { name: '核对后以当前版本继续编辑', exact: true }).click()
    await stale.getByRole('button', { name: '以当前版本继续编辑', exact: true }).click()
    await save(stale)
    await stale.close(); stale = undefined
    await page.reload(); await open(page); await select(page)
    if (process.env.CHECK_VAULT_AVATARS === '1') {
      await page.locator('.vault-entry-detail').getByRole('img', { name: process.env.CHECK_VAULT_CUSTOM_AVATARS === '1' ? '自定义头像' : '哔哩哔哩 头像', exact: true }).waitFor()
      if (process.env.CHECK_VAULT_CUSTOM_AVATARS !== '1') {
        await page.getByRole('button', { name: '编辑条目', exact: true }).click()
        await resetAvatar(page)
        await save(page)
      }
    }
    for (const [width, height] of [[1440, 900], [375, 900]]) {
      await page.setViewportSize({ width, height })
      await page.locator('.vault-entry-detail').scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: output + '/secure-note-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    const read = await page.request.get(new URL('/api/v1/vault', page.url()).href)
    await writeFile(output + '/vault-secure-note-report.json', JSON.stringify({ version: (await read.json()).version }))
    const persisted = await page.evaluate(async () => {
      const { listVaultDrafts } = await import('/src/modules/vault/draft-store.ts')
      const snapshot = await (await fetch('/api/v1/vault')).json()
      return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, drafts: await listVaultDrafts(snapshot.vaultId) })
    })
    assert.ok(!persisted.includes('M3_SECURE_') && !persisted.includes(master))
    assert.ok(!persisted.includes('"icon":'))
    assert.ok(!persisted.includes('data:image/png;base64,'))
    await nav(page).getByRole('button', { name: '笔记', exact: true }).click()
    await page.getByRole('button', { name: '新建笔记', exact: true }).click()
    await page.getByRole('button', { name: '前往保险库新建安全笔记', exact: true }).click()
    await page.getByRole('heading', { name: '保险库已锁定', exact: true }).waitFor()
  } else {
    await select(page)
    await preview(page).getByText('M3_SECURE_FAKE_MERGED', { exact: true }).waitFor()
    if (process.env.CHECK_VAULT_CUSTOM_AVATARS === '1') {
      const image = page.locator('.vault-entry-detail').getByRole('img', { name: '自定义头像', exact: true }).locator('img')
      assert.ok(await image.evaluate(async image => { await image.decode(); return image.naturalWidth === 128 && image.naturalHeight === 128 }))
    }
    await page.getByRole('menuitem', { name: /登录账号/ }).click()
    await page.locator('.vault-entry-row').filter({ hasText: 'M3_SECURE_FAKE_LOGIN' }).click()
    assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), 'M3_SECURE_FAKE_PASSWORD')
    if (process.env.CHECK_VAULT_AVATARS === '1') await page.locator('.vault-entry-detail').getByRole('img', { name: 'X 头像', exact: true }).waitFor()
  }
  if (process.env.CHECK_VAULT_TRASH === '1') {
    if (phase === 'secure-notes') {
      await checkVaultTrash(page, output, master)
      const response = await page.request.get(new URL('/api/v1/vault', page.url()).href)
      await writeFile(output + '/vault-secure-note-report.json', JSON.stringify({ version: (await response.json()).version }))
    } else await checkVaultTrashRestore(page)
  }
  if (process.env.CHECK_VAULT_DRAFT_BOX === '1' && phase === 'secure-notes') {
    await checkVaultDraftBox(page, output, master)
    const response = await page.request.get(new URL('/api/v1/vault', page.url()).href)
    await writeFile(output + '/vault-secure-note-report.json', JSON.stringify({ version: (await response.json()).version }))
  }
  assert.deepEqual(errors, [])
  assert.ok(requests.every(request => !request.url.includes('M3_SECURE_') && !request.body.includes('M3_SECURE_') && !request.body.includes(master)), 'No decrypted note fields may enter any HTTP request')
  assert.ok(requests.every(request => !request.body.includes('"icon":')), 'Selected platform identifiers belong only inside ciphertext')
  assert.ok(requests.every(request => !request.body.includes('data:image/png;base64,') && !request.url.includes('M3_CUSTOM_AVATAR_ORIGINAL')), 'Original file and thumbnail must never use ordinary upload or plaintext storage')
  if (customAvatarSource) assert.ok(requests.every(request => !request.body.includes(customAvatarSource)))
  assert.equal(requests.filter(request => /example\.invalid|\/api\/v1\/files\/content/.test(request.url)).length, 0, 'Preview must not fetch images or ordinary attachments')
  console.log('PASS: account-sessions-' + phase)
} catch (error) {
  if (page) await page.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => {})
  throw error
} finally { if (browser) await browser.close(); await server.close() }
