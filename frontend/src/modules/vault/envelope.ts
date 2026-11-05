import sodium from 'libsodium-wrappers-sumo'
import { parseContent, parseDraft, type VaultContent, type VaultDraft } from './entries'

export interface VaultEnvelope {
  format: 'private-space-vault'
  version: 1
  purpose: 'vault'
  vaultId: string
  keyId: string
  kdf: { algorithm: 'argon2id13'; ops: 3; memory: 67108864; salt: string }
  wrappedKey: { nonce: string; ciphertext: string }
  payload: { id: string; nonce: string; ciphertext: string }
}
export type EncryptedDraft = Omit<VaultEnvelope, 'purpose'> & { purpose: 'draft' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const maxPayload = 1024 * 1024
const encoder = new TextEncoder()
const b64 = (value: Uint8Array) => sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
const bytes = (value: string) => sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
function invalid(): never { throw new Error('VAULT_AUTHENTICATION_FAILED') }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid()
  return Object.fromEntries(Object.entries(value))
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) invalid()
  return value
}
function encoded(value: unknown, min: number, max = min): string {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3)) invalid()
  const decoded = bytes(value)
  if (decoded.length < min || decoded.length > max || b64(decoded) !== value) invalid()
  return value
}

/** Parse all untrusted metadata before any password-derived allocation. */
export function parseEnvelope(input: unknown, purpose?: 'vault'): Promise<VaultEnvelope>
export function parseEnvelope(input: unknown, purpose: 'draft'): Promise<EncryptedDraft>
export async function parseEnvelope(input: unknown, purpose: 'vault' | 'draft' = 'vault'): Promise<VaultEnvelope | EncryptedDraft> {
  await sodium.ready
  const value = object(input, ['format', 'version', 'purpose', 'vaultId', 'keyId', 'kdf', 'wrappedKey', 'payload'])
  if (value.format !== 'private-space-vault' || value.version !== 1 || value.purpose !== purpose) invalid()
  const kdf = object(value.kdf, ['algorithm', 'ops', 'memory', 'salt'])
  if (kdf.algorithm !== 'argon2id13' || kdf.ops !== 3 || kdf.memory !== 67108864) invalid()
  const wrapped = object(value.wrappedKey, ['nonce', 'ciphertext'])
  const payload = object(value.payload, ['id', 'nonce', 'ciphertext'])
  return {
    format: 'private-space-vault', version: 1, purpose, vaultId: id(value.vaultId), keyId: id(value.keyId),
    kdf: { algorithm: 'argon2id13', ops: 3, memory: 67108864, salt: encoded(kdf.salt, 16) },
    wrappedKey: { nonce: encoded(wrapped.nonce, 24), ciphertext: encoded(wrapped.ciphertext, 48) },
    payload: { id: id(payload.id), nonce: encoded(payload.nonce, 24), ciphertext: encoded(payload.ciphertext, 16, maxPayload + 16) },
  }
}
function keyContext(envelope: VaultEnvelope) {
  return JSON.stringify(['private-space-vault', 1, 'key', 'xchacha20poly1305-ietf', envelope.purpose,
    envelope.vaultId, envelope.keyId, envelope.kdf.algorithm, envelope.kdf.ops, envelope.kdf.memory, envelope.kdf.salt])
}
function payloadContext(envelope: VaultEnvelope | EncryptedDraft) {
  return JSON.stringify(['private-space-vault', 1, 'payload', 'xchacha20poly1305-ietf', envelope.purpose,
    envelope.vaultId, envelope.keyId, envelope.payload.id])
}
function derive(password: string, envelope: VaultEnvelope): Uint8Array {
  const input = encoder.encode(password)
  try {
    if (!input.length || input.length > 1024) invalid()
    return sodium.crypto_pwhash(32, input, bytes(envelope.kdf.salt), envelope.kdf.ops,
      envelope.kdf.memory, sodium.crypto_pwhash_ALG_ARGON2ID13)
  } finally { sodium.memzero(input) }
}

export async function createVault(password: string): Promise<{ envelope: VaultEnvelope; key: Uint8Array }> {
  await sodium.ready
  if ([...password].length < 12 || encoder.encode(password).length > 1024) invalid()
  const envelope: VaultEnvelope = {
    format: 'private-space-vault', version: 1, purpose: 'vault', vaultId: crypto.randomUUID(), keyId: crypto.randomUUID(),
    kdf: { algorithm: 'argon2id13', ops: 3, memory: 67108864, salt: b64(sodium.randombytes_buf(16)) },
    wrappedKey: { nonce: '', ciphertext: '' }, payload: { id: crypto.randomUUID(), nonce: '', ciphertext: '' },
  }
  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen()
  const plaintext = encoder.encode(JSON.stringify({ format: 'private-space-vault-content', version: 1, entries: [] }))
  let kek: Uint8Array | undefined
  try {
    kek = derive(password, envelope)
    const nonce = sodium.randombytes_buf(24)
    const wrappedNonce = sodium.randombytes_buf(24)
    envelope.payload = { ...envelope.payload, nonce: b64(nonce),
      ciphertext: b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, payloadContext(envelope), null, nonce, key)) }
    envelope.wrappedKey = { nonce: b64(wrappedNonce),
      ciphertext: b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, keyContext(envelope), null, wrappedNonce, kek)) }
    return { envelope, key }
  } catch (cause) { sodium.memzero(key); throw cause }
  finally { if (kek) sodium.memzero(kek); sodium.memzero(plaintext) }
}

/** Only the Worker holds the returned key. Decoded content is validated separately before display. */
export async function unlockVault(input: unknown, password: string, expectedId: string): Promise<Uint8Array> {
  const envelope = await parseEnvelope(input)
  if (envelope.vaultId !== expectedId) invalid()
  const kek = derive(password, envelope)
  let key: Uint8Array | undefined
  let plaintext: Uint8Array | undefined
  try {
    key = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.wrappedKey.ciphertext), keyContext(envelope), bytes(envelope.wrappedKey.nonce), kek)
    plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.payload.ciphertext), payloadContext(envelope), bytes(envelope.payload.nonce), key)
    parseContent(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)))
    return key
  } catch (cause) { if (key) sodium.memzero(key); throw cause }
  finally { sodium.memzero(kek); if (plaintext) sodium.memzero(plaintext) }
}

function readPayload(envelope: VaultEnvelope | EncryptedDraft, key: Uint8Array): unknown {
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.payload.ciphertext), payloadContext(envelope), bytes(envelope.payload.nonce), key)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) }
  finally { sodium.memzero(plaintext) }
}
function sealPayload<T extends VaultEnvelope | EncryptedDraft>(envelope: T, key: Uint8Array, content: VaultContent | VaultDraft): T {
  const next = { ...envelope, payload: { id: crypto.randomUUID(), nonce: '', ciphertext: '' } }
  const plaintext = encoder.encode(JSON.stringify(content))
  try {
    if (plaintext.length > maxPayload) invalid()
    const nonce = sodium.randombytes_buf(24)
    next.payload.nonce = b64(nonce)
    next.payload.ciphertext = b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, payloadContext(next), null, nonce, key))
    return next
  } finally { sodium.memzero(plaintext) }
}
export function readContent(envelope: VaultEnvelope, key: Uint8Array): VaultContent {
  return parseContent(readPayload(envelope, key))
}
export function sealContent(envelope: VaultEnvelope, key: Uint8Array, input: unknown): VaultEnvelope {
  return sealPayload(envelope, key, parseContent(input))
}
export function sealDraft(envelope: VaultEnvelope, key: Uint8Array, input: unknown): EncryptedDraft {
  return sealPayload({ ...envelope, purpose: 'draft' }, key, parseDraft(input))
}
export async function openDraft(input: unknown, current: VaultEnvelope, key: Uint8Array): Promise<VaultDraft> {
  const envelope = await parseEnvelope(input, 'draft')
  if (envelope.vaultId !== current.vaultId || envelope.keyId !== current.keyId) invalid()
  return parseDraft(readPayload(envelope, key))
}

/** Verify the old wrapper against the unlocked key, then rewrap without touching the payload. */
export async function rewrapVault(envelope: VaultEnvelope, key: Uint8Array, currentPassword: string, newPassword: string): Promise<VaultEnvelope> {
  await sodium.ready
  if ([...newPassword].length < 12 || encoder.encode(newPassword).length > 1024 || currentPassword === newPassword) invalid()
  let oldKek: Uint8Array | undefined
  let confirmedKey: Uint8Array | undefined
  let newKek: Uint8Array | undefined
  try {
    oldKek = derive(currentPassword, envelope)
    confirmedKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.wrappedKey.ciphertext), keyContext(envelope), bytes(envelope.wrappedKey.nonce), oldKek)
    if (!sodium.memcmp(confirmedKey, key)) invalid()
    const changed: VaultEnvelope = { ...envelope, kdf: { ...envelope.kdf, salt: b64(sodium.randombytes_buf(16)) } }
    newKek = derive(newPassword, changed)
    const nonce = sodium.randombytes_buf(24)
    changed.wrappedKey = { nonce: b64(nonce), ciphertext: b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, keyContext(changed), null, nonce, newKek)) }
    return changed
  } finally {
    if (oldKek) sodium.memzero(oldKek)
    if (confirmedKey) sodium.memzero(confirmedKey)
    if (newKek) sodium.memzero(newKek)
  }
}
