import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { checkSyncScope } from './check-sync-scope.mjs'

/** Uses the real Web UI for pairing and a real Tk/HTTP/Windows-file helper for the desktop flow. */
export async function checkSyncCenter(page, request, output) {
  const origin = new URL(page.url()).origin
  const nav = () => page.getByRole('navigation', { name: '主要导航' })
  await nav().getByRole('button', { name: '同步中心', exact: true }).click()
  await page.getByRole('heading', { name: '同步中心', exact: true }).waitFor()
  await page.getByLabel('设备名称', { exact: true }).fill('M2窗口验收')
  await page.getByRole('button', { name: '生成配对码', exact: true }).click()
  const code = await page.getByTestId('pairing-code').innerText()
  assert.equal(code.length, 43)
  const desktopOutput = new URL('desktop/', output)
  await mkdir(desktopOutput, { recursive: true })
  // No product page remains open while the native client performs background synchronization.
  await page.goto('about:blank')
  let report
  try {
    report = await new Promise((resolve, reject) => {
      const child = spawn('python', ['verification/check_desktop.py'], {
        cwd: fileURLToPath(new URL('../../sync-client/', import.meta.url)),
        env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error('Desktop real-chain timeout')) }, 150000)
      child.stdout.on('data', data => { stdout += data })
      child.stderr.on('data', data => { stderr += data })
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('close', exit => {
        clearTimeout(timer)
        if (exit === 0) {
          try { resolve(JSON.parse(stdout.trim())) } catch { reject(new Error('Desktop verification did not return a result')) }
        } else reject(new Error('Desktop verification failed: ' + stderr))
      })
      child.stdin.end(JSON.stringify({ code, output: fileURLToPath(desktopOutput) }) + '\n')
    })
  } finally { await page.goto(origin) }
  await nav().getByRole('button', { name: '同步中心', exact: true }).click()
  const row = page.locator(`[data-sync-device="${report.device}"]`)
  await row.waitFor()
  assert.ok((await row.innerText()).includes('已撤销'))
  assert.ok(!(await row.innerText()).includes('尚未联系'))
  assert.equal((await page.context().request.get(origin + '/api/v1/sync/snapshot')).status(), 401)
  // Verify Web confirmation separately; never store the generated code in screenshots or logs.
  const paired = await request('/sync-devices/pairing-code', 'POST', { name: '网页撤销验收' })
  const device = await page.evaluate(async code => {
    const response = await fetch('/api/v1/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
    const result = await response.json()
    return { id: result.id, status: response.status }
  }, paired.body.code)
  assert.equal(device.status, 200)
  await page.getByRole('button', { name: '刷新设备', exact: true }).click()
  await page.getByRole('button', { name: '撤销设备 网页撤销验收', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: '撤销设备授权' })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await request('/sync-devices')).body.find(item => item.id === device.id).revoked, false)
  await page.getByRole('button', { name: '撤销设备 网页撤销验收', exact: true }).click()
  await dialog.getByRole('button', { name: '撤销授权', exact: true }).click()
  await page.locator(`[data-sync-device="${device.id}"]`).getByText('已撤销', { exact: true }).waitFor()
  for (let index = 1; index <= 10; index++) {
    const pairing = await request('/sync-devices/pairing-code', 'POST', { name: '分页验收-' + index })
    assert.equal((await request('/sync/pair', 'POST', { code: pairing.body.code })).status, 200)
  }
  await page.getByRole('button', { name: '刷新设备', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-sync-device]').length === 10)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-sync-device]').length === 2)
  assert.ok((await page.locator('.sync-pagination').innerText()).includes('2 / 2'))
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-sync-device]').length === 10)
  for (const [width, height] of [[1440, 960], [375, 812], [812, 375]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: fileURLToPath(new URL(`sync-center-${width}.png`, output)) })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await writeFile(new URL('sync-center.json', output), JSON.stringify({ desktop: report, web: 'real one-use pairing, 12 persisted devices with 10/2 page split, last contact and confirmed revocation; responsive screenshots without pairing codes' }, null, 2))
  await checkSyncScope(page, request, output)
}
