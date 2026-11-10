import sodium from 'libsodium-wrappers-sumo'
import { parseContent, parseDraft, type VaultContent, type VaultDraft } from './entries'

import { parseEnvelope, maxPayload, type VaultEnvelope, type EncryptedDraft, type BackupEnvelope, type Envelope } from './envelope-format'
export { parseEnvelope, type VaultEnvelope, type EncryptedDraft, type BackupEnvelope } from './envelope-format'
type EnvelopeFields = Omit<VaultEnvelope, 'purpose'> & { purpose: Envelope['purpose'] }
const encoder = new TextEncoder()
const b64 = (value: Uint8Array) => sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
const bytes = (value: string) => sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
function invalid(): never { throw new Error('VAULT_AUTHENTICATION_FAILED') }
function keyContext(envelope: EnvelopeFields) {
  return JSON.stringify(['private-space-vault', 1, 'key', 'xchacha20poly1305-ietf', envelope.purpose,
    envelope.vaultId, envelope.keyId, envelope.kdf.algorithm, envelope.kdf.ops, envelope.kdf.memory, envelope.kdf.salt])
}
function payloadContext(envelope: EnvelopeFields) {
  return JSON.stringify(['private-space-vault', 1, 'payload', 'xchacha20poly1305-ietf', envelope.purpose,
    envelope.vaultId, envelope.keyId, envelope.payload.id])
}
function derive(password: string, envelope: EnvelopeFields): Uint8Array {
  const input = encoder.encode(password)
  try {
    if (!input.length || input.length > 1024) invalid()
    return sodium.crypto_pwhash(32, input, bytes(envelope.kdf.salt), envelope.kdf.ops,
      envelope.kdf.memory, sodium.crypto_pwhash_ALG_ARGON2ID13)
  } finally { sodium.memzero(input) }
}

async function createEncrypted<P extends 'vault' | 'backup'>(password: string, purpose: P, content: VaultContent): Promise<{ envelope: Omit<VaultEnvelope, 'purpose'> & { purpose: P }; key: Uint8Array }> {
  await sodium.ready
  if ([...password].length < 12 || encoder.encode(password).length > 1024) invalid()
  const envelope: Omit<VaultEnvelope, 'purpose'> & { purpose: P } = {
    format: 'private-space-vault', version: 1, purpose, vaultId: crypto.randomUUID(), keyId: crypto.randomUUID(),
    kdf: { algorithm: 'argon2id13', ops: 3, memory: 67108864, salt: b64(sodium.randombytes_buf(16)) },
    wrappedKey: { nonce: '', ciphertext: '' }, payload: { id: crypto.randomUUID(), nonce: '', ciphertext: '' },
  }
  const plaintext = encoder.encode(JSON.stringify(parseContent(content)))
  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen()
  let kek: Uint8Array | undefined
  try {
    if (plaintext.length > maxPayload) invalid()
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

export function createVault(password: string): Promise<{ envelope: VaultEnvelope; key: Uint8Array }> {
  return createEncrypted(password, 'vault', { format: 'private-space-vault-content', version: 1, entries: [] })
}

/** A backup gets its own random identities, data key and password wrapper. */
export async function createBackup(password: string, content: VaultContent): Promise<BackupEnvelope> {
  const result = await createEncrypted(password, 'backup', content)
  try { return result.envelope } finally { sodium.memzero(result.key) }
}

export async function openBackup(input: unknown, password: string): Promise<VaultContent> {
  const envelope = await parseEnvelope(input, 'backup')
  await sodium.ready
  const kek = derive(password, envelope)
  let key: Uint8Array | undefined
  try {
    key = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.wrappedKey.ciphertext), keyContext(envelope), bytes(envelope.wrappedKey.nonce), kek)
    return parseContent(readPayload(envelope, key))
  } finally { sodium.memzero(kek); if (key) sodium.memzero(key) }
}

/** Only the Worker holds the returned key. Decoded content is validated separately before display. */
export async function unlockVault(input: unknown, password: string, expectedId: string): Promise<Uint8Array> {
  const envelope = await parseEnvelope(input)
  if (envelope.vaultId !== expectedId) invalid()
  await sodium.ready
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

function readPayload(envelope: Envelope, key: Uint8Array): unknown {
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
  try {
    oldKek = derive(currentPassword, envelope)
    confirmedKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.wrappedKey.ciphertext), keyContext(envelope), bytes(envelope.wrappedKey.nonce), oldKek)
    if (!sodium.memcmp(confirmedKey, key)) invalid()
    return wrapDataKey(envelope, key, newPassword)
  } finally {
    if (oldKek) sodium.memzero(oldKek)
    if (confirmedKey) sodium.memzero(confirmedKey)
  }
}

/** Rewrap a previously authenticated data key without changing payload, identities, or history. */
export function wrapDataKey(envelope: VaultEnvelope, key: Uint8Array, newPassword: string): VaultEnvelope {
  if ([...newPassword].length < 12 || encoder.encode(newPassword).length > 1024) invalid()
  const changed: VaultEnvelope = { ...envelope, kdf: { ...envelope.kdf, salt: b64(sodium.randombytes_buf(16)) } }
  const kek = derive(newPassword, changed)
  try {
    const nonce = sodium.randombytes_buf(24)
    changed.wrappedKey = { nonce: b64(nonce), ciphertext: b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, keyContext(changed), null, nonce, kek)) }
    return changed
  } finally { sodium.memzero(kek) }
}
