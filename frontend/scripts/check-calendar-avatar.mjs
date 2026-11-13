import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const phase = process.argv[2], output = process.env.FEATURE_OUTPUT, password = process.env.FEATURE_PASSWORD
assert.ok(output && password && process.env.FEATURE_SETUP)
await mkdir(output, { recursive: true })
const origin = 'http://127.0.0.1:' + process.env.FEATURE_PORT
const server = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), root: process.cwd(), server: { host: '127.0.0.1', port: Number(process.env.FEATURE_PORT), strictPort: true, proxy: { '/api': process.env.FEATURE_BACKEND } } })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome' }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
async function api(path, method = 'GET', body, operation) {
  return page.evaluate(async ({ path, method, body, operation }) => {
    const { api } = await import('/src/shared/api/client.ts')
    try { return { status: 200, value: await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(operation ? { headers: { 'Idempotency-Key': operation } } : {}) }) } }
    catch (error) { return { status: error.status, code: error.code } }
  }, { path, method, body, operation })
}
async function nav(name) { await page.locator('.global-sidebar').getByRole('button', { name, exact: true }).click() }
async function unlock() { await page.locator('#vault-unlock').fill(password); await page.getByRole('button', { name: '解锁保险库', exact: true }).click(); await page.getByRole('button', { name: '新增登录条目', exact: true }).waitFor() }
async function saveEntry() {
  const response = page.waitForResponse(response => response.url().endsWith('/api/v1/vault') && response.request().method() === 'PUT')
  await page.getByRole('button', { name: '保存条目', exact: true }).click()
  assert.equal((await response).status(), 200)
  await page.getByRole('button', { name: '编辑条目', exact: true }).waitFor()
}
try {
  await page.goto(origin)
  assert.equal((await api('/home/calendar/records?month=2026-11')).status, 401)
  const status = await api('/auth/status')
  if (!status.value.initialized) assert.equal((await api('/auth/initialize', 'POST', { username: 'calendar-avatar-it', password, setupToken: process.env.FEATURE_SETUP })).status, 200)
  else assert.equal((await api('/auth/login', 'POST', { username: 'calendar-avatar-it', password })).status, 200)
  await page.reload(); await page.locator('.calendar-records').waitFor()
  const calendar = (await api('/home/calendar')).value
  const month = calendar.month, lastDay = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5)), 0)).getUTCDate()
  const date = `${month}-${lastDay}`, endDate = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5)), 1)).toISOString().slice(0,10)
  await page.locator(`[data-calendar-date="${date}"]`).click()
  if (phase === 'write') {
    const anonymous = await browser.newContext()
    assert.equal((await anonymous.request.get(origin + '/api/v1/home/calendar/records?month=' + month)).status(), 401)
    await anonymous.close()
    const csrf = await page.evaluate(async () => (await fetch('/api/v1/home/calendar/records/' + crypto.randomUUID(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status)
    assert.equal(csrf, 403)
    await page.getByRole('button', { name: '添加记录', exact: true }).click()
    await page.locator('.calendar-record-dialog').getByText('加班', { exact: true }).click()
    await page.getByLabel('标题', { exact: true }).fill('跨月加班测试')
    await page.locator('#calendar-record-start').fill(date + 'T22:00')
    await page.locator('#calendar-record-end').fill(endDate + 'T02:00')
    await page.locator('#calendar-record-overtime').fill('3.5')
    await page.getByText('开始至结束共 4 小时', { exact: false }).waitFor()
    await page.locator('.ant-modal-wrap').click({ position: { x: 5, y: 5 } })
    assert.ok(await page.locator('#calendar-record-title').isVisible(), 'Clicking outside must retain the dialog')
    await page.setViewportSize({ width: 375, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: output + '/overtime-form-mobile.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const savedResponse = page.waitForResponse(response => /\/home\/calendar\/records\//.test(response.url()) && response.request().method() === 'PUT')
    await page.getByRole('button', { name: '保存记录', exact: true }).click()
    const saved = await savedResponse; assert.equal(saved.status(), 200)
    const overtime = await saved.json(); assert.equal(overtime.overtimeMinutes, 210)
    await page.locator('.calendar-record-dialog').waitFor({ state: 'detached' })
    await page.getByTestId('overtime-summary').filter({ hasText: '3 小时 30 分钟' }).waitFor()
    await page.locator(`[data-calendar-date="${date}"] .calendar-record-dot`).waitFor()
    const raw = saved.request().postDataJSON(), operation = saved.request().headers()['idempotency-key'], path = '/home/calendar/records/' + overtime.id
    const replay = await api(path, 'PUT', raw, operation)
    assert.equal(replay.status, 200); assert.deepEqual(replay.value, overtime)
    assert.equal((await api(path, 'PUT', { ...raw, title: 'changed' }, operation)).status, 409)
    assert.equal((await api(path, 'PUT', { ...raw, baseVersion: '999' }, crypto.randomUUID())).status, 409)
    for (const invalid of [{ end: date + 'T21:59' }, { overtimeMinutes: 241 }, { overtimeMinutes: -1 }, { overtimeMinutes: 0.5 }, { start: 'bad' }]) assert.equal((await api(path, 'PUT', { ...raw, ...invalid, baseVersion: overtime.version }, crypto.randomUUID())).status, 400)
    await page.getByRole('button', { name: '添加记录', exact: true }).click()
    await page.locator('.calendar-record-dialog').getByText('其他', { exact: true }).click()
    await page.getByLabel('标题', { exact: true }).fill('其他日程测试')
    await page.locator('#calendar-record-time').fill('14:30')
    await page.getByRole('button', { name: '保存记录', exact: true }).click()
    await page.getByText('其他日程测试', { exact: true }).waitFor()
    const tasks = []
    for (let index = 0; index < 11; index++) {
      const id = crypto.randomUUID(), value = { baseVersion: '0', kind: 'todo', date, title: '日历待办 ' + index, notes: '独立数据库中的测试记录', time: index === 0 ? '08:00' : '09:00', completed: false, start: null, end: null, overtimeMinutes: null }
      const result = await api('/home/calendar/records/' + id, 'PUT', value, crypto.randomUUID())
      assert.equal(result.status, 200); tasks.push(result.value)
    }
    await page.reload(); await page.locator('.calendar-records').waitFor(); await page.locator(`[data-calendar-date="${date}"]`).click()
    await page.waitForFunction(() => document.querySelectorAll('.calendar-record').length === 10)
    assert.equal(await page.locator('.calendar-record').count(), 10)
    const scrollState = await page.locator('.calendar-record-list').evaluate(element => ({ overflowY: getComputedStyle(element).overflowY, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))
    assert.equal(scrollState.overflowY, 'auto')
    assert.ok(scrollState.scrollHeight > scrollState.clientHeight)
    assert.equal(await page.locator('.home-calendar').evaluate(element => getComputedStyle(element).overflowY), 'hidden')
    const monthTop = (await page.locator('.home-month').boundingBox()).y
    await page.locator(`[data-calendar-date="${date}"]`).hover()
    const recordTooltip = page.locator('.calendar-day-record-tooltip')
    await recordTooltip.waitFor()
    assert.match(await recordTooltip.innerText(), /日历待办|其他日程测试|跨月加班测试/)
    const todoRow = page.locator('.calendar-record').filter({ has: page.getByText('日历待办 0', { exact: true }) })
    const checkbox = todoRow.getByRole('checkbox')
    await checkbox.click()
    await page.waitForFunction(title => {
      const row = [...document.querySelectorAll('.calendar-record')].find(element => element.textContent?.includes(title))
      return row?.querySelector('input[type="checkbox"]')?.checked === true
    }, '日历待办 0')
    await todoRow.getByRole('button', { name: '编辑 日历待办 0', exact: true }).click()
    await page.locator('#calendar-record-title').fill('待办已编辑')
    await page.getByRole('button', { name: '保存记录', exact: true }).click()
    await page.getByRole('button', { name: '删除 待办已编辑', exact: true }).click()
    await page.locator('.confirmation-dialog').getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '删除 待办已编辑', exact: true }).waitFor({ state: 'detached' })
    await page.locator('.calendar-record-list').evaluate(list => { list.scrollTop = list.scrollHeight })
    await page.waitForFunction(() => document.querySelectorAll('.calendar-record').length === 12)
    assert.equal((await page.locator('.home-month').boundingBox()).y, monthTop, 'Record scrolling must keep the month calendar stationary')
    await page.locator('.home-content').evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.screenshot({ path: output + '/calendar-desktop.png', fullPage: true })
    const next = (await api('/home/calendar/records?month=' + endDate.slice(0,7))).value
    assert.equal(next.overtimeMinutes, 0)
    const rows = (await api('/home/calendar/records?month=' + month + '&date=' + date)).value
    assert.equal(rows.overtimeMinutes, 210); assert.equal(rows.days.find(day => day.date === date).pending, 10); assert.equal(rows.days.find(day => day.date === date).others, 1)
    assert.equal(rows.days.find(day => day.date === date).overtimes, 1); assert.equal(rows.days.find(day => day.date === date).previews.length, 3)
    await page.setViewportSize({ width: 375, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const calendarBox = await page.locator('.home-calendar').boundingBox(), learningBox = await page.locator('.learning-summary').boundingBox()
    assert.ok(calendarBox && learningBox && calendarBox.y < learningBox.y, 'Calendar must appear before learning cards on narrow screens')
    await page.locator('.calendar-records').scrollIntoViewIfNeeded()
    await page.screenshot({ path: output + '/calendar-mobile.png' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    // Initialize a real encrypted vault using fictitious secrets and the actual Worker/API.
    await page.evaluate(async password => {
      const { VaultWorker } = await import('/src/modules/vault/worker-client.ts'), { api } = await import('/src/shared/api/client.ts')
      const worker = new VaultWorker()
      try { const result = await worker.request({ kind: 'create', password }); if (result.kind !== 'created') throw Error('create failed'); await api('/vault', { method: 'POST', body: JSON.stringify({ envelope: result.envelope }), headers: { 'Idempotency-Key': crypto.randomUUID() } }) }
      finally { worker.lock() }
    }, password)
    await nav('密码保险库'); await unlock()
    await page.getByRole('button', { name: '新增登录条目', exact: true }).click()
    await page.locator('#vault-entry-name').fill('头像来源测试条目')
    await page.getByRole('button', { name: '选择头像', exact: true }).click()
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const drawing = canvas.getContext('2d'); drawing.fillStyle = '#526b83'; drawing.fillRect(0,0,64,64); return canvas.toDataURL().split(',')[1] })
    await page.getByLabel('自定义头像图片', { exact: true }).setInputFiles({ name: 'isolated-test-avatar.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.getByRole('button', { name: '使用自定义头像', exact: true }).waitFor()
    await page.getByRole('button', { name: '使用此头像', exact: true }).click()
    await saveEntry()
    await page.getByRole('button', { name: '删除条目', exact: true }).click()
    await page.locator('.confirmation-dialog').getByRole('button', { name: '确认移入回收站', exact: true }).click()
    await page.getByRole('button', { name: '恢复条目', exact: true }).waitFor()
    // Physically remove the source entry in the isolated fixture, preserving the encrypted gallery.
    const proof = await page.evaluate(async password => {
      const { VaultWorker } = await import('/src/modules/vault/worker-client.ts'), { api } = await import('/src/shared/api/client.ts')
      const snapshot = await api('/vault'), worker = new VaultWorker()
      try {
        const opened = await worker.request({ kind: 'unlock', password, envelope: snapshot.envelope, id: snapshot.envelope.vaultId })
        if (opened.kind !== 'unlocked' || opened.avatars.length !== 1) throw Error('missing gallery')
        const content = { format: 'private-space-vault-content', version: 1, entries: [], avatars: opened.avatars }
        const sealed = await worker.request({ kind: 'seal', content })
        if (sealed.kind !== 'sealed') throw Error('seal failed')
        const saved = await api('/vault', { method: 'PUT', body: JSON.stringify({ baseVersion: snapshot.version, envelope: sealed.envelope }), headers: { 'Idempotency-Key': crypto.randomUUID() } })
        const exported = await worker.request({ kind: 'backup-export', envelope: saved.envelope, currentPassword: password, backupPassword: password + '-backup' })
        if (exported.kind !== 'backup-exported') throw Error('backup failed')
        const preview = await worker.request({ kind: 'backup-preview', backup: exported.backup, backupPassword: password + '-backup' })
        const candidate = await worker.request({ kind: 'backup-build', token: preview.token })
        const restored = await worker.request({ kind: 'inspect', envelope: candidate.envelope })
        return { entries: restored.entries.length, avatars: restored.avatars.length, thumbnailAbsentFromServerJson: !JSON.stringify(saved).includes(opened.avatars[0].dataUrl) }
      } finally { worker.lock() }
    }, password)
    assert.deepEqual(proof, { entries: 0, avatars: 1, thumbnailAbsentFromServerJson: true })
    await writeFile(output + '/state.json', JSON.stringify({ month, date, proof, overtimeId: overtime.id }))
  }
  // This phase also runs after the Java server has been stopped and restarted.
  if (phase === 'restart') {
    const state = JSON.parse(await readFile(output + '/state.json', 'utf8'))
    const persisted = (await api('/home/calendar/records?month=' + state.month + '&date=' + state.date)).value
    assert.equal(persisted.total, 12); assert.equal(persisted.overtimeMinutes, 210)
    assert.ok(persisted.items.some(item => item.id === state.overtimeId) || persisted.total > 10)
  }
  await page.reload(); await page.locator('.home-month').waitFor(); await nav('密码保险库'); await unlock()
  await page.getByRole('button', { name: '新建安全笔记', exact: true }).click()
  await page.locator('#vault-entry-name').fill('复用头像的安全笔记')
  await page.getByRole('button', { name: '选择头像', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '使用已保存头像 1', exact: true }).count(), 1)
  await page.getByRole('button', { name: '使用已保存头像 1', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 844 })
  await page.screenshot({ path: output + '/avatar-gallery-mobile-' + phase + '.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.getByRole('button', { name: '使用此头像', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await saveEntry()
  await page.getByRole('button', { name: '立即锁定', exact: true }).click(); await unlock()
  await page.locator('.vault-entry-row').first().click()
  await page.locator('.vault-entry-detail').getByRole('img', { name: '自定义头像', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  await writeFile(output + '/result-' + phase + '.json', JSON.stringify({ realMySqlAndHttp: true, realWorkerEncryption: true, errors, phase }))
  console.log('PASS calendar and encrypted avatar gallery: ' + phase)
} catch (error) { await page.screenshot({ path: output + '/failure-' + phase + '.png', fullPage: true }).catch(() => {}); throw error }
finally { await browser.close(); await server.close() }
