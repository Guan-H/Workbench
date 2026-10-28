import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { chromium } from 'playwright'
import { createServer } from 'vite'

const phase = process.argv[2]
const backend = process.env.VERIFICATION_BACKEND
const token = process.env.VERIFICATION_TOKEN
const id = process.env.VERIFICATION_VAULT_ID
assert.ok(['write', 'restore'].includes(phase) && token && id)
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const output = new URL(`../test-results/vault-${id}/`, import.meta.url)
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, proxy: { '/api': backend } },
  logLevel: 'error',
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address === 'object')
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' })
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  const pageErrors = []
  const apiRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (!request.url().includes('/api/verification/')) return
    const body = request.postData() ?? ''
    assert.ok(!['M0_TEST_SECRET', 'M0_FAKE_MASTER', 'M0_FAKE_BACKUP', 'example.invalid', '虚构账号']
      .some((marker) => body.includes(marker)))
    apiRequests.push({ method: request.method(), path: new URL(request.url()).pathname, plaintextAbsent: true })
  })
  await page.goto(`http://127.0.0.1:${address.port}/verification/vault/index.html`)
  let result
  if (phase === 'write') {
    const [observation, download] = await Promise.all([
      page.evaluate(async ({ id, token }) => {
        const scenario = await import('/verification/vault/scenario.ts')
        return scenario.writeScenario(id, token)
      }, { id, token }),
      page.waitForEvent('download'),
    ])
    result = observation
    await download.saveAs(fileURLToPath(new URL('backup.encrypted.json', output)))
    await page.reload()
    assert.equal(await page.evaluate(async ({ id, token }) => {
      const scenario = await import('/verification/vault/scenario.ts')
      return scenario.recoverDraftAfterReload(id, token)
    }, { id, token }), true)
  } else {
    const backupText = await readFile(new URL('backup.encrypted.json', output), 'utf8')
    assert.ok(!backupText.includes('M0_TEST_SECRET') && !backupText.includes('M0_FAKE_BACKUP'))
    const offline = spawnSync(process.execPath, ['--experimental-strip-types',
      fileURLToPath(new URL('../verification/vault/recover.ts', import.meta.url)),
      fileURLToPath(new URL('backup.encrypted.json', output)), '--check'], {
      input: 'M0_FAKE_BACKUP_independent_only_for_verification', encoding: 'utf8', timeout: 30000,
    })
    assert.equal(offline.status, 0, 'Independent offline recovery tool failed')
    const prior = JSON.parse(await readFile(new URL('write.json', output), 'utf8'))
    assert.equal(JSON.parse(offline.stdout).sha256, prior.payloadSha256)
    const wrong = spawnSync(process.execPath, ['--experimental-strip-types',
      fileURLToPath(new URL('../verification/vault/recover.ts', import.meta.url)),
      fileURLToPath(new URL('backup.encrypted.json', output)), '--check'], {
      input: 'wrong-backup-password', encoding: 'utf8', timeout: 30000,
    })
    assert.equal(wrong.status, 1)
    assert.equal(wrong.stdout, '')
    result = await page.evaluate(async ({ id, token, backupText }) => {
      const scenario = await import('/verification/vault/scenario.ts')
      return scenario.restoreScenario(id, token, backupText)
    }, { id, token, backupText })
    result.cases.push('independent Node process decrypts local backup without an API; wrong backup password rejected')
  }
  assert.deepEqual(pageErrors, [])
  await writeFile(new URL(`${phase}.json`, output), JSON.stringify({
    checkedAt: new Date().toISOString(), phase, ...result, apiRequests, pageErrors,
    limitation: 'M0 candidate only; no product authentication or independent security audit',
  }, null, 2))
  console.log(`PASS: vault-crypto-${phase}; ${result.cases.length} groups; real browser, HTTP, MySQL`)
} finally {
  await browser?.close()
  await server.close()
}
