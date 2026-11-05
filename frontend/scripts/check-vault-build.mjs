import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// Serve the real build with the actual production Caddy configuration, using no account or real secrets.
const project = fileURLToPath(new URL('../../', import.meta.url))
const image = 'caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f'
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
const mounts = ['--env', 'WORKBENCH_DOMAIN=:80', '-v', project + 'deploy/production/Caddyfile:/etc/caddy/Caddyfile:ro', '-v', project + 'frontend/dist:/srv:ro']
const worker = (await readdir(new URL('../dist/assets/', import.meta.url))).find(name => /^vault-worker-[\w-]+\.js$/.test(name))
assert.ok(worker, 'Build the frontend first')
const probeName = 'vault-csp-check-' + crypto.randomUUID() + '.js'
const probe = new URL('../dist/' + probeName, import.meta.url)
let container, browser
try {
  // Run as an ordinary external script: DevTools evaluation can bypass eval restrictions.
  await writeFile(probe, `(async () => {
    let evalBlocked = false, pageWasmBlocked = false;
    try { new Function('return 1')() } catch { evalBlocked = true }
    try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])) } catch { pageWasmBlocked = true }
    window.vaultCspResult = { evalBlocked, pageWasmBlocked };
  })();`)
  docker('run', '--rm', ...mounts, image, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile')
  container = docker('run', '--rm', '-d', '-p', '127.0.0.1::80', ...mounts, image)
  const binding = docker('port', container, '80/tcp')
  assert.match(binding, /^127\.0\.0\.1:\d+$/)
  const origin = 'http://' + binding
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(origin)).ok) { ready = true; break } } catch { /* Wait for the temporary container only. */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready)
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  const main = await page.goto(origin)
  const workerResponse = await page.request.get(origin + '/assets/' + worker)
  assert.equal(workerResponse.status(), 200)
  assert.ok(!main.headers()['content-security-policy'].includes('wasm-unsafe-eval'))
  assert.ok(workerResponse.headers()['content-security-policy'].includes("script-src 'self' 'wasm-unsafe-eval'"))
  assert.ok(!workerResponse.headers()['content-security-policy'].includes("'unsafe-eval'"))
  await page.addScriptTag({ url: origin + '/' + probeName })
  await page.waitForFunction(() => window.vaultCspResult)
  assert.deepEqual(await page.evaluate(() => window.vaultCspResult), { evalBlocked: true, pageWasmBlocked: true })
  const result = await page.evaluate(async path => {
    const worker = new Worker(path, { type: 'module' })
    async function request(command) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker timed out')), 30000)
        worker.onerror = () => { clearTimeout(timer); reject(new Error('Worker failed')) }
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data) }
        worker.postMessage(command)
      })
    }
    try {
      const password = 'M3_FAKE_BUILD_CHECK_only'
      const created = await request({ kind: 'create', password })
      const locked = await request({ kind: 'lock' })
      const unlocked = await request({ kind: 'unlock', envelope: created.envelope, id: created.envelope?.vaultId, password })
      const now = new Date().toISOString()
      const entry = { id: crypto.randomUUID(), type: 'login', name: 'Build test', urls: [], username: '', password: 'M3_FAKE_BUILD_ENTRY',
        notes: '', tags: [], favorite: false, fields: [], createdAt: now, updatedAt: now }
      const sealed = await request({ kind: 'seal', content: { format: 'private-space-vault-content', version: 1, entries: [entry] } })
      const adopted = await request({ kind: 'adopt', envelope: sealed.envelope })
      const draft = await request({ kind: 'draft', draft: { format: 'private-space-vault-draft-content', version: 1, baseVersion: '1', entry: { ...entry, notes: 'M3_FAKE_BUILD_DRAFT' }, original: entry } })
      const rewrapped = await request({ kind: 'rewrap', currentPassword: password, newPassword: password + 'changed' })
      await request({ kind: 'lock' })
      const changed = await request({ kind: 'unlock', envelope: rewrapped.envelope, id: created.envelope?.vaultId, password: password + 'changed' })
      const recovered = await request({ kind: 'open-draft', envelope: draft.envelope })
      const rejected = await request({ kind: 'unlock', envelope: rewrapped.envelope, id: created.envelope?.vaultId, password })
      const lockedRewrap = await request({ kind: 'rewrap', currentPassword: password + 'changed', newPassword: password + 'again' })
      return { createdFields: Object.keys(created).sort(), locked: locked.kind, unlocked: unlocked.kind,
        rewrappedFields: Object.keys(rewrapped).sort(), changed: changed.kind, rejected: rejected.kind, lockedRewrap: lockedRewrap.kind,
        sealedFields: Object.keys(sealed).sort(), adopted: adopted.kind, entryPreserved: changed.entries?.[0]?.password === entry.password,
        recovered: recovered.draft?.entry?.notes === 'M3_FAKE_BUILD_DRAFT', draftPurpose: draft.envelope?.purpose }
    } finally { worker.terminate() }
  }, '/assets/' + worker)
  assert.deepEqual(result, { createdFields: ['envelope', 'kind'], locked: 'locked', unlocked: 'unlocked',
    rewrappedFields: ['envelope', 'kind'], changed: 'unlocked', rejected: 'error', lockedRewrap: 'error',
    sealedFields: ['envelope', 'kind'], adopted: 'adopted', entryPreserved: true, recovered: true, draftPurpose: 'draft' })
  console.log('PASS: built vault entries/drafts/rewrap/lock and production Caddy CSP; page eval/Wasm remain blocked')
} finally {
  if (browser) await browser.close()
  if (container) docker('stop', container)
  await unlink(probe)
}
