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
export type BackupEnvelope = Omit<VaultEnvelope, 'purpose'> & { purpose: 'backup' }
export type Envelope = VaultEnvelope | EncryptedDraft | BackupEnvelope
export const maxPayload = 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
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
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) invalid()
  let decoded: string
  try { decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/')) } catch { return invalid() }
  if (decoded.length < min || decoded.length > max || btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== value) invalid()
  return value
}

/** Structural validation needs no cryptography runtime on the page. KDF runs only after this boundary. */
export function parseEnvelope(input: unknown, purpose?: 'vault'): Promise<VaultEnvelope>
export function parseEnvelope(input: unknown, purpose: 'draft'): Promise<EncryptedDraft>
export function parseEnvelope(input: unknown, purpose: 'backup'): Promise<BackupEnvelope>
export async function parseEnvelope(input: unknown, purpose: Envelope['purpose'] = 'vault'): Promise<Envelope> {
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
