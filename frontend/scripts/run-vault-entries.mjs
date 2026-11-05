import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { checkVaultEntries } from './check-vault-entries.mjs'

const output = process.env.SESSIONS_OUTPUT
const backend = process.env.SESSIONS_BACKEND
const port = Number(process.env.SESSIONS_FRONTEND_PORT)
assert.ok(output && port)
assert.match(backend ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
const server = await createServer({ configFile: false, plugins: [vue()], root: fileURLToPath(new URL('../', import.meta.url)),
  logLevel: 'error', optimizeDeps: { include: ['libsodium-wrappers-sumo'] }, server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } } })
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ storageState: output + '/browser-a.json', viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}`)
  await checkVaultEntries(page, output)
  assert.deepEqual(errors, [])
  console.log('PASS: account-sessions-entries')
} catch (error) {
  if (page) await page.screenshot({ path: output + '/failure-entries.png', fullPage: true }).catch(() => {})
  throw error
} finally { if (browser) await browser.close(); await server.close() }
