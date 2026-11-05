import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

const backend = process.env.NOTES_BACKEND
const port = Number(process.env.NOTES_FRONTEND_PORT)
const directory = process.env.CONFLICT_OUTPUT
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const fixture = JSON.parse(await readFile(directory + '/web-conflicts.json', 'utf8'))
const server = await createServer({ configFile: false, plugins: [vue()], root: fileURLToPath(new URL('../', import.meta.url)),
  logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + port)
  await page.getByLabel('用户名', { exact: true }).fill('notes-it')
  await page.getByLabel('登录口令', { exact: true }).fill(process.env.NOTES_PASSWORD)
  await page.getByRole('button', { name: '进入私有空间' }).click()
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '同步中心', exact: true }).click()
  const panel = page.locator('.sync-conflicts')
  async function open(device, name) {
    const table = page.locator('.sync-devices')
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = table.locator(`[data-sync-device="${device}"]`)
      if (await row.count()) { await row.getByRole('button', { name: '查看冲突记录 ' + name, exact: true }).click(); return }
      const next = table.getByRole('button', { name: '下一页', exact: true })
      if (await next.isEnabled()) await next.click()
      else await table.getByRole('button', { name: '上一页', exact: true }).click()
    }
    throw new Error('fixture device not found')
  }
  await page.locator('[data-sync-device]').first().waitFor()
  // Persist real devices when the isolated fixture has fewer than two pages.
  const deviceCount = await page.evaluate(async () => {
    const { api, write } = await import('/src/shared/api/client.ts')
    const devices = await api('/sync-devices')
    for (let index = devices.length; index < 13; index++) {
      const { code } = await write('/sync-devices/pairing-code', 'POST', { name: '分页布局验收-' + index })
      await write('/sync/pair', 'POST', { code })
    }
    return Math.max(devices.length, 13)
  })
  await page.getByRole('button', { name: '刷新设备', exact: true }).click()
  const pagination = page.getByRole('navigation', { name: '设备列表分页', exact: true })
  await pagination.getByText(`共 ${Math.ceil(deviceCount / 10)} 页`, { exact: false }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('[data-sync-device]').length === 10)
  assert.equal(await page.locator('[data-sync-device]').count(), 10)
  for (const [width, height] of [[1440, 800], [375, 600]]) {
    await page.setViewportSize({ width, height })
    await pagination.scrollIntoViewIfNeeded()
    assert.ok(await pagination.evaluate(element => {
      const boxes = [...element.querySelectorAll('.ant-pagination > li')].map(item => item.getBoundingClientRect())
      return boxes.every((box, index) => boxes.slice(index + 1).every(other =>
        Math.min(box.right, other.right) - Math.max(box.left, other.left) <= 0.5 ||
        Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) <= 0.5))
    }), 'pagination controls do not overlap')
    const scroll = await page.locator('.sync-devices .ant-table-body').evaluate(element => ({
      vertical: element.scrollHeight > element.clientHeight, horizontal: element.scrollWidth > element.clientWidth, height: element.clientHeight,
    }))
    assert.ok(scroll.vertical && scroll.height <= Math.min(420, height / 2) + 1, 'device rows scroll inside the bounded table')
    if (width === 375) assert.ok(scroll.horizontal, 'wide columns scroll inside the narrow table')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: directory + '/device-pagination-' + width + '.png', fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await pagination.getByRole('button', { name: '下一页', exact: true }).click()
  await pagination.getByText('第 2 页', { exact: false }).waitFor()
  await page.waitForFunction(expected => document.querySelectorAll('[data-sync-device]').length === expected, Math.min(10, deviceCount - 10))
  assert.equal(await page.locator('[data-sync-device]').count(), Math.min(10, deviceCount - 10))
  await pagination.getByRole('button', { name: '上一页', exact: true }).click()
  await pagination.getByText('第 1 页', { exact: false }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.ant-message-notice'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: '刷新设备', exact: true }).click()
  const refreshed = page.getByRole('status').filter({ hasText: /^刷新成功$/ })
  await refreshed.waitFor()
  const shown = Date.now()
  await page.waitForFunction(() => document.querySelector('.ant-message-notice.ant-message-move-up-leave-active'))
  assert.ok(Date.now() - shown >= 1700, 'refresh result stays visible for two seconds')
  const fade = await page.locator('.ant-message-notice.ant-message-move-up-leave-active').evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration }))
  assert.equal(fade.name, 'message-fade-out')
  assert.equal(fade.duration, '0.25s')
  await refreshed.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '刷新设备', exact: true }).click()
  await refreshed.waitFor()
  await page.getByRole('button', { name: '关闭消息', exact: true }).click()
  await refreshed.waitFor({ state: 'hidden' })
  await open(fixture.device, fixture.name)
  await panel.locator('[data-conflict-path]').first().waitFor()
  await panel.getByLabel('最后上报的助手状态').getByText(/冲突 24/).waitFor()
  await panel.getByRole('button', { name: '同步记录', exact: true }).click()
  await page.locator('[data-sync-activity]').first().waitFor()
  assert.ok(await page.locator('[data-sync-activity]').count() >= 2)
  await panel.getByRole('button', { name: '已处理记录', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sync-conflicts [data-conflict-path]').length === 2)
  assert.equal(await panel.getByText(/保留服务器版本/).count(), 2)
  await panel.getByRole('button', { name: '待处理', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sync-conflicts [data-conflict-path]').length === 20)
  assert.equal(await panel.locator('[data-conflict-path]').count(), 20)
  await panel.getByRole('button', { name: '下一页', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sync-conflicts [data-conflict-path]').length === 4)
  await panel.getByRole('button', { name: '上一页', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sync-conflicts [data-conflict-path]').length === 20)
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 960 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(await panel.locator('.sync-device-scroll').evaluate(element => element.scrollHeight > element.clientHeight))
    await page.screenshot({ path: directory + '/web-conflicts-' + width + '.png', fullPage: true })
  }
  await context.setOffline(true)
  await panel.getByRole('button', { name: '刷新冲突记录' }).click()
  await panel.getByRole('alert').waitFor()
  await context.setOffline(false)
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await panel.locator('[data-conflict-path]').first().waitFor()
  async function write(path, method, body) {
    return page.evaluate(async ({ path, method, body }) => {
      const { token } = await (await fetch('/api/v1/auth/csrf')).json()
      const response = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token }, body: body ? JSON.stringify(body) : undefined })
      if (!response.ok) throw new Error('fixture mutation failed: ' + response.status)
      return response.json()
    }, { path, method, body })
  }
  await write('/sync-devices/' + fixture.device + '/scope', 'PUT', { scope: { all: true, folders: [] }, baseVersion: '1' })
  await page.getByRole('button', { name: '刷新设备', exact: true }).click()
  await panel.getByText(/旧范围记录/).first().waitFor()
  await write('/sync-devices/' + fixture.device, 'DELETE')
  await page.getByRole('button', { name: '刷新设备', exact: true }).click()
  await panel.getByText('设备已撤销，以下历史记录不会再由该设备更新。').waitFor()
  await open(fixture.unknown, fixture.unknownName)
  await panel.getByText(/此设备尚未成功上报冲突状态/).waitFor()
  assert.equal(await panel.locator('[data-conflict-path]').count(), 0)
  assert.deepEqual(errors, [])
  await writeFile(directory + '/web-conflicts-result.json', JSON.stringify({ realBrowserAndBackend: true, pagination: '20/4',
    desktopAndNarrowScreens: true, unreportedIsUnknown: true, revokedAndOldScopeMarked: true,
    networkFaultInjection: 'actual browser offline then online retry; no substituted business responses' }, null, 2))
  console.log('PASS: web-conflicts')
} finally {
  await browser?.close(); await server.close()
}
