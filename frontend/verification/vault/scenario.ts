import type { Envelope } from './crypto'
import type { Command } from './crypto.worker'

// Publicly recognizable fake fixtures only. No real user data is accepted by this scenario.
const MASTER = 'M0_FAKE_MASTER_old_only_for_verification'
const NEW_MASTER = 'M0_FAKE_MASTER_new_only_for_verification'
const BACKUP = 'M0_FAKE_BACKUP_independent_only_for_verification'
const fixtures = JSON.stringify(Array.from({ length: 500 }, (_, index) => ({
  name: `虚构账号 ${index}`, username: `user-${index}@example.invalid`,
  password: `M0_TEST_SECRET_${index}`, note: '# 安全笔记\n仅供自动验证。',
})))

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}

function task<T>(command: Command): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), { type: 'module' })
    const timer = window.setTimeout(() => { worker.terminate(); reject(new Error('WORKER_TIMEOUT')) }, 20000)
    const cleanup = () => { window.clearTimeout(timer); worker.terminate() }
    worker.onerror = () => { cleanup(); reject(new Error('WORKER_FAILED')) }
    worker.onmessage = (message: MessageEvent<{ ok: boolean; result: T }>) => {
      cleanup()
      if (message.data.ok) resolve(message.data.result)
      else reject(new Error('CRYPTO_REJECTED'))
    }
    worker.postMessage(command)
  })
}

async function rejects(operation: () => Promise<unknown>, label: string) {
  let rejected = false
  try { await operation() } catch { rejected = true }
  assert(rejected, label)
}

async function request(id: string, token: string, envelope?: Envelope, version?: string) {
  return fetch(`/api/verification/vault/${id}`, {
    method: envelope ? 'PUT' : 'GET',
    headers: { 'X-Verification-Token': token, 'Content-Type': 'application/json' },
    body: envelope ? JSON.stringify({ baseVersion: version, envelope: JSON.stringify(envelope) }) : undefined,
    cache: 'no-store',
  })
}

async function read(id: string, token: string): Promise<{ version: string; envelope: Envelope }> {
  const response = await request(id, token)
  assert(response.ok, 'READ_FAILED')
  const saved = await response.json() as { version: string; envelope: string }
  return { version: saved.version, envelope: JSON.parse(saved.envelope) as Envelope }
}

async function storeDraft(envelope: Envelope) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open('m0-encrypted-drafts', 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts')
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(new Error('DRAFT_DB_FAILED'))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      transaction.objectStore('drafts').put(JSON.stringify(envelope), 'unsaved')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('DRAFT_SAVE_FAILED'))
    })
  } finally { db.close() }
}

async function loadDraft(): Promise<Envelope> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open('m0-encrypted-drafts', 1)
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(new Error('DRAFT_OPEN_FAILED'))
  })
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const get = db.transaction('drafts').objectStore('drafts').get('unsaved')
      get.onsuccess = () => resolve(String(get.result))
      get.onerror = () => reject(new Error('DRAFT_READ_FAILED'))
    })
    assert(!text.includes('M0_TEST_SECRET') && !text.includes('M0_FAKE_MASTER'), 'PLAINTEXT_DRAFT')
    return JSON.parse(text) as Envelope
  } finally { db.close() }
}

export async function writeScenario(id: string, token: string) {
  const cases: string[] = []
  let ticks = 0
  const interval = window.setInterval(() => ticks++, 20)
  const start = performance.now()
  let original: Envelope
  try {
    original = await task<Envelope>({ action: 'create', plaintext: fixtures, password: MASTER, id })
  } finally { window.clearInterval(interval) }
  const createMilliseconds = Math.round(performance.now() - start)
  assert(ticks > 0, 'MAIN_THREAD_BLOCKED')
  assert((await request(id, '')).status === 401, 'UNAUTHENTICATED_READ_ACCEPTED')
  assert((await request(id, token, original, '0')).ok, 'CREATE_FAILED')
  const saved = await read(id, token)
  assert(await task<string>({ action: 'open', envelope: saved.envelope, password: MASTER, id }) === fixtures, 'ROUND_TRIP_FAILED')
  cases.push('500 fake entries: browser worker -> authenticated HTTP -> MySQL -> browser decrypt')

  await rejects(() => task({ action: 'open', envelope: original, password: 'wrong', id }), 'WRONG_PASSWORD_ACCEPTED')
  for (const field of ['ciphertext', 'nonce'] as const) {
    const tampered = structuredClone(original)
    tampered.payload[field] = (tampered.payload[field][0] === 'A' ? 'B' : 'A') + tampered.payload[field].slice(1)
    await rejects(() => task({ action: 'open', envelope: tampered, password: MASTER, id }), 'TAMPER_ACCEPTED')
    await rejects(() => task({ action: 'update', envelope: tampered, password: MASTER, plaintext: '' }), 'TAMPER_OVERWRITTEN')
  }
  for (const mutation of ['version', 'kdf', 'purpose', 'payloadId', 'keyId', 'wrappedKey'] as const) {
    const tampered = structuredClone(original)
    if (mutation === 'version') Object.assign(tampered, { version: 99 })
    if (mutation === 'kdf') tampered.kdf.memory *= 1024
    if (mutation === 'purpose') tampered.purpose = 'backup'
    if (mutation === 'payloadId') tampered.payload.id = crypto.randomUUID()
    if (mutation === 'keyId') tampered.keyId = crypto.randomUUID()
    if (mutation === 'wrappedKey') tampered.wrappedKey.ciphertext = (tampered.wrappedKey.ciphertext[0] === 'A' ? 'B' : 'A') + tampered.wrappedKey.ciphertext.slice(1)
    await rejects(() => task({ action: 'open', envelope: tampered, password: MASTER, id }), 'METADATA_TAMPER_ACCEPTED')
  }
  await rejects(() => task({ action: 'open', envelope: original, password: MASTER, id: crypto.randomUUID() }), 'CROSS_VAULT_ACCEPTED')
  cases.push('wrong password, ciphertext/nonce/metadata tamper, unknown format, excessive KDF and cross-vault binding rejected')

  const local = await task<Envelope>({ action: 'update', envelope: original, password: MASTER, plaintext: fixtures + '\nlocal draft' })
  const remote = await task<Envelope>({ action: 'update', envelope: original, password: MASTER, plaintext: fixtures + '\nremote draft' })
  assert(local.payload.nonce !== original.payload.nonce && local.payload.nonce !== remote.payload.nonce, 'REUSED_NONCE')
  await storeDraft(local)
  const races = await Promise.all([request(id, token, local, '1'), request(id, token, remote, '1')])
  assert(races.filter((response) => response.status === 200).length === 1, 'CAS_WINNER_COUNT')
  assert(races.filter((response) => response.status === 409).length === 1, 'CAS_CONFLICT_COUNT')
  const current = await read(id, token)
  assert(current.version === '2', 'CAS_VERSION_FAILED')
  cases.push('two real concurrent writes: exactly one commit, one 409; encrypted unsaved draft preserved in IndexedDB')

  const changed = await task<Envelope>({ action: 'change', envelope: current.envelope, oldPassword: MASTER, newPassword: NEW_MASTER })
  assert(changed.payload.ciphertext === current.envelope.payload.ciphertext, 'REKEY_CHANGED_PAYLOAD')
  assert(changed.kdf.salt !== current.envelope.kdf.salt, 'REKEY_REUSED_SALT')
  assert((await request(id, token, changed, '2')).ok, 'REKEY_SAVE_FAILED')
  assert((await request(id, token, original, '2')).status === 409, 'STALE_REKEY_ACCEPTED')
  await rejects(() => task({ action: 'open', envelope: changed, password: MASTER, id }), 'OLD_PASSWORD_ACCEPTED')
  const plaintext = await task<string>({ action: 'open', envelope: changed, password: NEW_MASTER, id })
  assert(plaintext.startsWith(fixtures), 'NEW_PASSWORD_FAILED')
  assert(await task<string>({ action: 'history', history: original, current: changed, password: NEW_MASTER }) === fixtures, 'HISTORY_REKEY_FAILED')
  cases.push('password change: current new password opens old encrypted history; stale replacement rejected atomically')

  const draft = await loadDraft()
  assert((await task<string>({ action: 'history', history: draft, current: changed, password: NEW_MASTER })).endsWith('local draft'), 'DRAFT_REKEY_FAILED')
  const backup = await task<Envelope>({ action: 'create', plaintext, password: BACKUP, id, purpose: 'backup' })
  assert(backup.keyId !== changed.keyId, 'BACKUP_REUSED_KEY')
  await rejects(() => task({ action: 'open', envelope: backup, password: NEW_MASTER, id, purpose: 'backup' }), 'ONLINE_PASSWORD_OPENED_BACKUP')
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'm0-virtual-vault.encrypted.json'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  assert(localStorage.length === 0 && sessionStorage.length === 0, 'UNEXPECTED_BROWSER_STORAGE')
  cases.push('independent backup password and fresh data key; only encrypted JSON downloaded')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext))
  const payloadSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return { cases, createMilliseconds, mainThreadTicks: ticks, payloadSha256 }
}

export async function restoreScenario(id: string, token: string, backupText: string) {
  const saved = await read(id, token)
  assert(saved.version === '3', 'RESTART_LOST_VERSION')
  const current = await task<string>({ action: 'open', envelope: saved.envelope, password: NEW_MASTER, id })
  const backup = JSON.parse(backupText) as Envelope
  const plaintext = await task<string>({ action: 'open', envelope: backup, password: BACKUP, id, purpose: 'backup' })
  assert(plaintext === current, 'INDEPENDENT_RECOVERY_FAILED')
  const freshId = crypto.randomUUID()
  const restored = await task<Envelope>({ action: 'create', plaintext, password: NEW_MASTER, id: freshId })
  assert((await request(freshId, token, restored, '0')).ok, 'NEW_VAULT_RESTORE_FAILED')
  assert(await task<string>({ action: 'open', envelope: (await read(freshId, token)).envelope, password: NEW_MASTER, id: freshId }) === current, 'RESTORED_READ_FAILED')
  return { cases: ['fresh browser context and restarted backend read version 3 from MySQL', 'encrypted backup restored into a new vault ID with a new data key'] }
}

export async function recoverDraftAfterReload(id: string, token: string) {
  const current = await read(id, token)
  const draft = await loadDraft()
  await rejects(() => task({ action: 'history', history: draft, current: current.envelope, password: MASTER }), 'OLD_PASSWORD_OPENED_DRAFT')
  assert((await task<string>({ action: 'history', history: draft, current: current.envelope, password: NEW_MASTER })).endsWith('local draft'), 'RELOAD_LOST_DRAFT')
  return true
}
