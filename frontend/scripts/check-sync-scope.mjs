import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'

export async function checkSyncScope(page, request, output) {
  const origin = new URL(page.url()).origin
  for (const path of ['选择工作', '选择个人', '选择工作相似', '共享附件']) {
    assert.equal((await request('/notes', 'POST', { path, type: 'folder', content: '' })).status, 200)
  }
  assert.equal((await request('/sync-devices/pairing-code', 'POST', { name: '空范围不得配对', scope: { all: false, folders: [] } })).status, 400)
  assert.equal((await request('/sync-devices/pairing-code', 'POST', { name: '系统目录不得配对', scope: { all: false, folders: ['node_modules'] } })).status, 400)
  assert.equal((await request('/sync-devices/pairing-code', 'POST', { name: '无效目录不得配对', scope: { all: false, folders: ['不存在的目录'] } })).status, 409)
  await page.goto(origin)
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '同步中心', exact: true }).click()
  await page.getByLabel('设备名称', { exact: true }).fill('选择范围设备')
  const panel = page.locator('.sync-pairing')
  await panel.getByRole('radio', { name: '选择文件夹', exact: true }).check()
  assert.equal(await panel.getByRole('button', { name: '生成配对码', exact: true }).isDisabled(), true)
  await panel.getByRole('searchbox', { name: '搜索同步目录' }).fill('选择')
  await panel.getByRole('checkbox', { name: '同步目录：选择工作', exact: true }).check()
  await panel.getByRole('checkbox', { name: '同步目录：选择个人', exact: true }).check()
  await panel.getByRole('button', { name: '生成配对码', exact: true }).click()
  const code = await page.getByTestId('pairing-code').innerText()
  const directory = new URL('selected-sync/', output)
  await mkdir(directory, { recursive: true })
  await page.goto('about:blank')
  let report
  try {
    report = await new Promise((resolve, reject) => {
      const child = spawn('python', ['verification/check_scoped_sync.py'], { cwd: fileURLToPath(new URL('../../sync-client/', import.meta.url)), env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error('Scoped real-chain timeout')) }, 150000)
      child.stdout.on('data', data => { stdout += data })
      child.stderr.on('data', data => { stderr += data })
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('close', exit => {
        clearTimeout(timer)
        if (exit !== 0) reject(new Error('Scoped verification failed: ' + stderr))
        else { try { resolve(JSON.parse(stdout.trim())) } catch { reject(new Error('Invalid scope verification output')) } }
      })
      child.stdin.end(JSON.stringify({ code, output: fileURLToPath(directory) }) + '\n')
    })
  } finally { await page.goto(origin) }
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '同步中心', exact: true }).click()
  await page.locator('[data-sync-device]').first().waitFor()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  const row = page.locator(`[data-sync-device="${report.device}"]`)
  await row.waitFor()
  assert.ok((await row.innerText()).includes('选择工作'))
  await row.getByRole('button', { name: '修改同步范围 选择范围设备', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '修改同步范围', exact: true })
  await dialog.getByRole('searchbox', { name: '搜索同步目录' }).fill('选择')
  for (const [width, height] of [[1440, 960], [375, 812]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal(await dialog.locator('.sync-scope-folders label').first().evaluate(element => getComputedStyle(element).display), 'flex')
    await page.screenshot({ path: fileURLToPath(new URL(`scope-dialog-${width}.png`, output)) })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await dialog.getByRole('checkbox', { name: '同步目录：选择个人', exact: true }).uncheck()
  await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } })
  assert.equal(await dialog.isVisible(), true)
  await dialog.getByRole('button', { name: '保存范围', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const current = (await request('/sync-devices')).body.find(item => item.id === report.device)
  assert.deepEqual(current.scope, { all: false, folders: ['选择工作'] })
}
