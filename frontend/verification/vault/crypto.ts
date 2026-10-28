/** M0 candidate only. Not imported by the product application or approved for real secrets. */
import sodium from 'libsodium-wrappers-sumo'

export interface Envelope {
  format: 'private-space-candidate'
  version: 1
  purpose: 'vault' | 'backup'
  vaultId: string
  keyId: string
  kdf: { algorithm: 'argon2id13'; ops: number; memory: number; salt: string }
  wrappedKey: { nonce: string; ciphertext: string }
  payload: { id: string; nonce: string; ciphertext: string }
}

const MEMORY = 64 * 1024 * 1024
const MAX_BYTES = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const encoder = new TextEncoder()
function fail(): never { throw new Error('INVALID_OR_UNAUTHENTICATED_ENVELOPE') }
const b64 = (bytes: Uint8Array) => sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING)
const bytes = (value: string) => sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)

function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail()
}

function encoded(value: unknown, minimum: number, maximum = minimum) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum * 4 / 3) + 4) fail()
  const decoded = bytes(value as string)
  if (decoded.length < minimum || decoded.length > maximum || b64(decoded) !== value) fail()
}

function validate(input: unknown): asserts input is Envelope {
  fields(input, ['format', 'version', 'purpose', 'vaultId', 'keyId', 'kdf', 'wrappedKey', 'payload'])
  if (input.format !== 'private-space-candidate' || input.version !== 1
    || !['vault', 'backup'].includes(String(input.purpose))
    || typeof input.vaultId !== 'string' || !UUID.test(input.vaultId)
    || typeof input.keyId !== 'string' || !UUID.test(input.keyId)) fail()
  fields(input.kdf, ['algorithm', 'ops', 'memory', 'salt'])
  // Bound untrusted KDF parameters before allocation; imports cannot demand arbitrary CPU/RAM.
  if (input.kdf.algorithm !== 'argon2id13' || input.kdf.ops !== 3 || input.kdf.memory !== MEMORY) fail()
  encoded(input.kdf.salt, 16)
  fields(input.wrappedKey, ['nonce', 'ciphertext'])
  encoded(input.wrappedKey.nonce, 24)
  encoded(input.wrappedKey.ciphertext, 48)
  fields(input.payload, ['id', 'nonce', 'ciphertext'])
  if (typeof input.payload.id !== 'string' || !UUID.test(input.payload.id)) fail()
  encoded(input.payload.nonce, 24)
  encoded(input.payload.ciphertext, 16, MAX_BYTES + 16)
}

export async function parseEnvelope(text: string): Promise<Envelope> {
  await sodium.ready
  if (text.length > MAX_BYTES * 2) fail()
  const input: unknown = JSON.parse(text)
  validate(input)
  return input
}

function keyContext(envelope: Envelope) {
  return JSON.stringify(['private-space-candidate', 1, 'key', 'xchacha20poly1305-ietf',
    envelope.purpose, envelope.vaultId, envelope.keyId, envelope.kdf.algorithm,
    envelope.kdf.ops, envelope.kdf.memory, envelope.kdf.salt])
}

function payloadContext(envelope: Envelope) {
  return JSON.stringify(['private-space-candidate', 1, 'payload', 'xchacha20poly1305-ietf',
    envelope.purpose, envelope.vaultId, envelope.keyId, envelope.payload.id])
}

function derive(password: string, envelope: Envelope): Uint8Array {
  const input = encoder.encode(password)
  try {
    if (input.length < 1 || input.length > 1024) fail()
    return sodium.crypto_pwhash(32, input, bytes(envelope.kdf.salt), envelope.kdf.ops,
      envelope.kdf.memory, sodium.crypto_pwhash_ALG_ARGON2ID13)
  } finally {
    sodium.memzero(input)
  }
}

function wrap(envelope: Envelope, key: Uint8Array, password: string) {
  const kek = derive(password, envelope)
  try {
    const nonce = sodium.randombytes_buf(24)
    envelope.wrappedKey = {
      nonce: b64(nonce),
      ciphertext: b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, keyContext(envelope), null, nonce, kek)),
    }
  } finally {
    sodium.memzero(kek)
  }
}

function unwrap(envelope: Envelope, password: string): Uint8Array {
  const kek = derive(password, envelope)
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.wrappedKey.ciphertext),
      keyContext(envelope), bytes(envelope.wrappedKey.nonce), kek)
  } finally {
    sodium.memzero(kek)
  }
}

function decrypt(envelope: Envelope, key: Uint8Array) {
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(envelope.payload.ciphertext),
    payloadContext(envelope), bytes(envelope.payload.nonce), key)
}

function encrypt(envelope: Envelope, key: Uint8Array, plaintext: string) {
  const input = encoder.encode(plaintext)
  try {
    if (input.length > MAX_BYTES) fail()
    envelope.payload.id = crypto.randomUUID()
    const nonce = sodium.randombytes_buf(24)
    envelope.payload.nonce = b64(nonce)
    envelope.payload.ciphertext = b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      input, payloadContext(envelope), null, nonce, key))
  } finally {
    sodium.memzero(input)
  }
}

function bind(envelope: Envelope, expectedId: string, purpose: Envelope['purpose']) {
  validate(envelope)
  if (envelope.vaultId !== expectedId || envelope.purpose !== purpose) fail()
}

export async function createEnvelope(plaintext: string, password: string, vaultId: string,
  purpose: Envelope['purpose'] = 'vault'): Promise<Envelope> {
  await sodium.ready
  if (!UUID.test(vaultId)) fail()
  const envelope: Envelope = {
    format: 'private-space-candidate', version: 1, purpose, vaultId, keyId: crypto.randomUUID(),
    kdf: { algorithm: 'argon2id13', ops: 3, memory: MEMORY, salt: b64(sodium.randombytes_buf(16)) },
    wrappedKey: { nonce: '', ciphertext: '' }, payload: { id: crypto.randomUUID(), nonce: '', ciphertext: '' },
  }
  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen()
  try {
    encrypt(envelope, key, plaintext)
    wrap(envelope, key, password)
    return envelope
  } finally {
    sodium.memzero(key)
  }
}

export async function openEnvelope(envelope: Envelope, password: string, expectedId: string,
  purpose: Envelope['purpose'] = 'vault'): Promise<string> {
  await sodium.ready
  bind(envelope, expectedId, purpose)
  const key = unwrap(envelope, password)
  let plaintext: Uint8Array | undefined
  try {
    plaintext = decrypt(envelope, key)
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } finally {
    sodium.memzero(key)
    if (plaintext) sodium.memzero(plaintext)
  }
}

export async function changePassword(envelope: Envelope, oldPassword: string, newPassword: string): Promise<Envelope> {
  await sodium.ready
  validate(envelope)
  const key = unwrap(envelope, oldPassword)
  let plaintext: Uint8Array | undefined
  try {
    // Authenticate the full original before proposing a replacement wrapper; never mutate it in place.
    plaintext = decrypt(envelope, key)
    const next = structuredClone(envelope)
    next.kdf.salt = b64(sodium.randombytes_buf(16))
    wrap(next, key, newPassword)
    return next
  } finally {
    sodium.memzero(key)
    if (plaintext) sodium.memzero(plaintext)
  }
}

export async function updateContent(envelope: Envelope, password: string, plaintext: string): Promise<Envelope> {
  await sodium.ready
  validate(envelope)
  const key = unwrap(envelope, password)
  let previous: Uint8Array | undefined
  try {
    previous = decrypt(envelope, key)
    const next = structuredClone(envelope)
    encrypt(next, key, plaintext)
    return next
  } finally {
    sodium.memzero(key)
    if (previous) sodium.memzero(previous)
  }
}

export async function openHistory(history: Envelope, current: Envelope, password: string): Promise<string> {
  await sodium.ready
  bind(history, current.vaultId, 'vault')
  validate(current)
  if (history.keyId !== current.keyId || current.purpose !== 'vault') fail()
  const key = unwrap(current, password)
  let plaintext: Uint8Array | undefined
  try {
    plaintext = decrypt(history, key)
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } finally {
    sodium.memzero(key)
    if (plaintext) sodium.memzero(plaintext)
  }
}
