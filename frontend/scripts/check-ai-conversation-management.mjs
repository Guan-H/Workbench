import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { chromium, request } from 'playwright'

// Opt in: this runs against the local backend and generates two real DeepSeek replies.
const password = process.env.WORKBENCH_LOCAL_CHECK_PASSWORD
assert.ok(password && process.env.WORKBENCH_CHECK_LIVE_AI === '1', 'Set local test password and opt in to real model requests.')
const origin = 'http://127.0.0.1:5173'
const root = '/api/v1/ai/conversations'
const api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } })
const marker = '联调-' + randomUUID().slice(0, 8)
const title = marker + '-会议%_纪要'
let browser, loggedIn, chatId, streamReader

async function write(path, method, data) {
  const { token } = await (await api.get('/api/v1/auth/csrf')).json()
  return api.fetch(path, { method, data, headers: { 'X-CSRF-TOKEN': token } })
}

async function json(response, status = 200) {
  assert.equal(response.status(), status, response.status() === status ? '' : await response.text())
  return response.json()
}

try {
  assert.equal((await api.get(root + '?query=' + marker)).status(), 401)
  assert.equal((await write('/api/v1/auth/login', 'POST', { username: 'admin', password })).status(), 200)
  loggedIn = true
  const config = await json(await api.get('/api/v1/ai/settings'))
  assert.ok(config.keyConfigured && config.encryptionReady && config.models.length)
  const modelId = config.models[0].modelId
  const chat = await json(await write(root, 'POST'))
  chatId = chat.id
  const base = root + '/' + chatId
  const detail = async () => json(await api.get(base))
  const search = async keyword => json(await api.get(root, { params: { query: keyword } }))
  browser = await chromium.launch({ channel: 'chrome' })
  const state = await api.storageState()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state })
  await context.addInitScript(id => sessionStorage.setItem('workbench-ai-chat:admin', id), chatId)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))
  await page.goto(origin)
  await page.locator('[data-nav=ai]').click()
  let history = page.locator('.desktop-history')
  const row = () => history.locator(`[data-chat-id="${chatId}"]`)
  const menu = async label => {
    await row().getByRole('button', { name: /管理会话/ }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  await menu('重命名')
  await page.getByLabel('会话标题', { exact: true }).fill(title)
  await page.getByRole('button', { name: '保存标题' }).click()
  await row().getByText(title, { exact: true }).waitFor()
  const renamed = (await detail()).conversation
  assert.equal(renamed.title, title)
  assert.equal((await search('%_' + '纪要')).some(row => row.id === chatId), true)
  assert.deepEqual((await search(marker)).map(row => row.id), [chatId])
  const desktopSearch = history.getByRole('textbox', { name: '搜索会话标题' })
  await desktopSearch.fill(marker + '-不存在')
  await history.getByText('没有匹配的标题', { exact: false }).waitFor()
  await desktopSearch.fill(marker)
  await row().waitFor()
  assert.equal(await history.locator('[data-chat-id]').count(), 1)
  await menu('置顶')
  await row().getByRole('img', { name: '已置顶' }).waitFor()
  const pinned = (await detail()).conversation
  assert.equal(pinned.pinned, true)
  const listed = await search('')
  assert.ok(listed.slice(0, listed.findIndex(row => row.id === chatId)).every(row => row.pinned))
  assert.equal((await write(base + '/title', 'PUT', { title: '旧版本写入', revision: renamed.revision })).status(), 409)
  assert.equal((await write(base + '?revision=' + renamed.revision, 'DELETE')).status(), 409)
  assert.equal((await write(base + '/title', 'PUT', { title: ' ', revision: pinned.revision })).status(), 400)
  assert.equal((await detail()).conversation.title, title)
  await page.reload()
  await page.locator('[data-nav=ai]').click()
  await row().getByRole('img', { name: '已置顶' }).waitFor()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click()
  history = page.locator('.ant-drawer .drawer-history')
  await history.getByRole('textbox', { name: '搜索会话标题' }).fill(marker)
  await row().waitFor()
  await menu('取消置顶')
  await row().getByRole('img', { name: '已置顶' }).waitFor({ state: 'hidden' })
  assert.equal((await detail()).conversation.pinned, false)
  await menu('删除')
  await page.getByRole('heading', { name: '永久删除会话' }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await detail()).conversation.title, title)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await row().getByText(title, { exact: true }).click()

  const prompt = '用于界面联调的虚构材料：请按序号分别列出 35 个完全虚构的英文会议场景，每项完整写出一条英文句子。'
  const initial = await json(await write(base + '/turns', 'POST', {
    id: randomUUID(), revision: (await detail()).conversation.revision, modelId, text: prompt,
  }))
  const answerPath = id => base + '/answers/' + id
  let prior
  for (let n = 0; n < 180; n++) {
    prior = await json(await api.get(answerPath(initial.answerId)))
    if (prior.status !== 'generating') break
    await wait(330)
  }
  assert.ok(['complete', 'truncated'].includes(prior?.status), prior?.errorMessage)
  assert.equal((await detail()).conversation.title, title, 'first message must not replace a custom title')
  const next = await json(await write(base + '/turns/' + initial.id + '/regenerate', 'POST', {
    id: randomUUID(), revision: (await detail()).conversation.revision, modelId,
  }))
  assert.equal(next.version, 2)
  const cookie = state.cookies.map(item => item.name + '=' + item.value).join('; ')
  const subscription = await fetch(origin + answerPath(next.answerId) + '/events', {
    headers: { cookie }, signal: AbortSignal.timeout(20000),
  })
  assert.equal(subscription.status, 200)
  streamReader = subscription.body.pipeThrough(new TextDecoderStream()).getReader()
  let events = ''
  while (!events.includes('event: snapshot')) {
    const { value, done } = await streamReader.read()
    assert.equal(done, false)
    events += value
  }
  assert.match(events, /"status":"generating"/)
  await page.getByRole('button', { name: '重新读取会话', exact: true }).click()
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor()
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click()
  await menu('删除')
  assert.equal((await detail()).activeAnswer?.status, 'generating')
  const deletion = page.waitForResponse(res => res.url().includes(base + '?revision=') && res.request().method() === 'DELETE')
  await page.getByRole('button', { name: '永久删除', exact: true }).click()
  assert.equal((await deletion).status(), 204)
  while (!events.includes('event: deleted')) {
    const { value, done } = await streamReader.read()
    assert.equal(done, false, 'SSE must tell other views about deletion')
    events += value
  }
  await row().waitFor({ state: 'hidden' })
  await wait(750)
  assert.equal((await api.get(base)).status(), 404)
  assert.equal((await api.get(answerPath(initial.answerId))).status(), 404)
  assert.equal((await api.get(answerPath(next.answerId))).status(), 404)
  assert.equal((await search(marker)).length, 0)
  assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ conversation: chatId, legacyTurn: initial.id, oldAnswer: initial.answerId, runningAnswer: next.answerId,
    desktop: true, mobile: true, rename: true, search: true, pinnedAfterReload: true, unpin: true,
    staleWriteRejected: true, cancelDoesNotDelete: true, activeDeletion: true, sseDeleted: true }))
  chatId = undefined
} finally {
  await streamReader?.cancel().catch(() => undefined)
  await browser?.close()
  if (loggedIn) {
    if (chatId) {
      const response = await api.get(root + '/' + chatId)
      if (response.ok()) {
        const { conversation } = await response.json()
        await write(root + '/' + chatId + '?revision=' + conversation.revision, 'DELETE')
      }
    }
    await write('/api/v1/auth/logout', 'POST')
  }
  await api.dispose()
}
