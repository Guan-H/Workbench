import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

// Actual built Worker and IndexedDB only. This does not replace HTTP/database recovery acceptance.
const output = fileURLToPath(new URL('../test-results/vault-backup-worker/', import.meta.url))
await mkdir(output, { recursive: true })
const assets = new URL('../dist/assets/', import.meta.url)
const filename = (await readdir(assets)).find(name => /^vault-worker-.*\.js$/.test(name))
assert.ok(filename)
const compiled = await readFile(new URL(filename, assets))
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'built-backup-worker-check', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== '/__backup_check__' && request.url !== '/__built_worker__.js') { next(); return }
      response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/html')
      response.setHeader('Content-Security-Policy', request.url.endsWith('.js')
        ? "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'"
        : "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'")
      response.end(request.url.endsWith('.js') ? compiled : '<!doctype html><title>Built backup Worker verification</title>')
    })
  } }] })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0] + '__backup_check__')
  const download = page.waitForEvent('download').catch(() => undefined)
  const result = await page.evaluate(async () => {
    const { storeRestore, readRestore } = await import('/src/modules/vault/restore-store.ts')
    function client() {
      const worker = new Worker('/__built_worker__.js', { type: 'module' })
      return { worker, command(value) { return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Built Worker timed out')), 30000)
        worker.onerror = () => { clearTimeout(timer); reject(new Error('Built Worker failed')) }
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data) }
        worker.postMessage(value)
      }) } }
    }
    const main = client(), restored = client()
    const master = 'BACKUP_FAKE_BROWSER_MASTER', password = 'BACKUP_FAKE_BROWSER_PASSWORD'
    try {
      const created = await main.command({ kind: 'create', password: master })
      const now = new Date().toISOString()
      const entry = { id: crypto.randomUUID(), type: 'secure-note', name: 'BACKUP_FAKE_NAME', body: 'BACKUP_FAKE_SECRET', icon: 'google', tags: [], favorite: false, deletedAt: now, createdAt: now, updatedAt: now }
      const content = { format: 'private-space-vault-content', version: 1, entries: [entry] }
      const sealed = await main.command({ kind: 'seal', content })
      await main.command({ kind: 'adopt', envelope: sealed.envelope })
      const first = await main.command({ kind: 'backup-export', envelope: sealed.envelope, currentPassword: master, backupPassword: password })
      const second = await main.command({ kind: 'backup-export', envelope: sealed.envelope, currentPassword: master, backupPassword: password })
      const invalid = structuredClone(first.backup); invalid.envelope.kdf.memory = 1073741824
      const rejectedParameters = await restored.command({ kind: 'backup-preview', backup: invalid, backupPassword: password })
      const rejectedPassword = await restored.command({ kind: 'backup-preview', backup: first.backup, backupPassword: password + 'wrong' })
      const tampered = structuredClone(first.backup)
      const cipher = tampered.envelope.payload.ciphertext
      tampered.envelope.payload.ciphertext = (cipher[0] === 'A' ? 'B' : 'A') + cipher.slice(1)
      const rejectedCipher = await restored.command({ kind: 'backup-preview', backup: tampered, backupPassword: password })
      const preview = await restored.command({ kind: 'backup-preview', backup: first.backup, backupPassword: password })
      const candidate = await restored.command({ kind: 'backup-build', token: preview.token, newPassword: master + '_new' })
      const opened = await restored.command({ kind: 'unlock', envelope: candidate.envelope, password: master + '_new', id: candidate.envelope.vaultId })
      const oldPassword = await restored.command({ kind: 'unlock', envelope: candidate.envelope, password: master, id: candidate.envelope.vaultId })
      const existingPreview = await main.command({ kind: 'backup-preview', backup: first.backup, backupPassword: password })
      const existing = await main.command({ kind: 'backup-build', token: existingPreview.token })
      const lockPreview = await main.command({ kind: 'backup-preview', backup: first.backup, backupPassword: password })
      await main.command({ kind: 'lock' })
      const locked = await main.command({ kind: 'backup-build', token: lockPreview.token })
      const request = { mode: 'replace', baseVersion: '1', operation: crypto.randomUUID(), envelope: existing.envelope }
      await storeRestore('backup-worker-check', request)
      let concurrentRejected = false
      try { await storeRestore('backup-worker-check', { ...request, operation: crypto.randomUUID() }) } catch { concurrentRejected = true }
      const stored = await readRestore('backup-worker-check')
      const otherAccount = await readRestore('another-account')
      const url = URL.createObjectURL(new Blob([JSON.stringify(first.backup)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'worker-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { exported: first.kind, independent: first.backup.envelope.keyId !== sealed.envelope.keyId && first.backup.envelope.vaultId !== sealed.envelope.vaultId,
        random: first.backup.envelope.keyId !== second.backup.envelope.keyId && first.backup.envelope.payload.nonce !== second.backup.envelope.payload.nonce,
        rejectedParameters: rejectedParameters.kind, rejectedPassword: rejectedPassword.kind, rejectedCipher: rejectedCipher.kind,
        summary: preview.summary, recovered: Object.entries(entry).every(([key, value]) => JSON.stringify(opened.entries?.[0]?.[key]) === JSON.stringify(value)), oldPassword: oldPassword.kind,
        originalWrapper: JSON.stringify(existing.envelope.wrappedKey) === JSON.stringify(sealed.envelope.wrappedKey),
        locked: locked.kind, persisted: JSON.stringify(stored) === JSON.stringify(request), concurrentRejected, isolated: otherAccount === undefined,
        plaintext: JSON.stringify(stored).includes('BACKUP_FAKE_') || JSON.stringify(first.backup).includes('BACKUP_FAKE_') }
    } finally { main.worker.terminate(); restored.worker.terminate() }
  })
  assert.deepEqual(result, { exported: 'backup-exported', independent: true, random: true, rejectedParameters: 'backup-rejected', rejectedPassword: 'backup-rejected', rejectedCipher: 'backup-rejected',
    summary: { total: 1, login: 0, secureNote: 1, deleted: 1 }, recovered: true, oldPassword: 'error', originalWrapper: true,
    locked: 'backup-rejected', persisted: true, concurrentRejected: true, isolated: true, plaintext: false })
  const downloaded = await download
  assert.ok(downloaded)
  await downloaded.saveAs(output + '/worker-backup.json')
  const downloadedText = await readFile(output + '/worker-backup.json', 'utf8')
  assert.equal(JSON.parse(downloadedText).format, 'private-space-vault-backup')
  assert.ok(!downloadedText.includes('BACKUP_FAKE_'))
  await page.reload()
  assert.equal(await page.evaluate(async () => { const { readRestore } = await import('/src/modules/vault/restore-store.ts'); return !!await readRestore('backup-worker-check') }), true)
  assert.deepEqual(errors, [])
  console.log('PASS: built Worker cryptography/CSP and real IndexedDB persistence. HTTP, database and UI recovery remain unverified by this check.')
} finally { if (browser) await browser.close(); await server.close() }
