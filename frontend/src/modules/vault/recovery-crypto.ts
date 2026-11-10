import sodium from 'libsodium-wrappers-sumo'
import { readContent, unlockVault, wrapDataKey } from './envelope'
import type { VaultEnvelope } from './envelope-format'
import { parseRecovery, type RecoveryEnvelope } from './recovery-format'

const b64 = (value: Uint8Array) => sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
const bytes = (value: string) => sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
const context = (value: RecoveryEnvelope) => JSON.stringify(['private-space-vault-recovery', 1, 'data-key', 'xchacha20poly1305-ietf', value.vaultId, value.keyId, value.id])
function recoveryKey(secret: string): Uint8Array {
  const normalized = secret.replace(/[\s-]/g, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('RECOVERY_SECRET_INVALID')
  return sodium.from_hex(normalized)
}
export async function generateRecovery(envelope: VaultEnvelope, key: Uint8Array, password: string): Promise<{ secret: string; recovery: RecoveryEnvelope }> {
  const verified = await unlockVault(envelope, password, envelope.vaultId)
  try { if (!sodium.memcmp(verified, key)) throw new Error('RECOVERY_KEY_MISMATCH') } finally { sodium.memzero(verified) }
  const wrappingKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen()
  try {
    const recovery: RecoveryEnvelope = { format: 'private-space-vault-recovery', version: 1, vaultId: envelope.vaultId,
      keyId: envelope.keyId, id: crypto.randomUUID(), nonce: b64(sodium.randombytes_buf(24)), ciphertext: '' }
    recovery.ciphertext = b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, context(recovery), null, bytes(recovery.nonce), wrappingKey))
    const text = sodium.to_hex(wrappingKey).toUpperCase()
    return { secret: Array.from({ length: 8 }, (_, i) => text.slice(i * 8, i * 8 + 8)).join('-'), recovery }
  } finally { sodium.memzero(wrappingKey) }
}
/** Authentication of both the key wrapper and current payload happens before a new wrapper is built. */
export async function recoverDataKey(envelope: VaultEnvelope, input: unknown, secret: string): Promise<Uint8Array> {
  await sodium.ready
  const recovery = parseRecovery(input)
  if (recovery.vaultId !== envelope.vaultId || recovery.keyId !== envelope.keyId) throw new Error('RECOVERY_IDENTITY_MISMATCH')
  const wrappingKey = recoveryKey(secret)
  let key: Uint8Array | undefined
  try {
    key = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(recovery.ciphertext), context(recovery), bytes(recovery.nonce), wrappingKey)
    readContent(envelope, key)
    return key
  } catch (cause) { if (key) sodium.memzero(key); throw cause }
  finally { sodium.memzero(wrappingKey) }
}
export async function resetWithRecovery(envelope: VaultEnvelope, recovery: unknown, secret: string, password: string): Promise<VaultEnvelope> {
  const key = await recoverDataKey(envelope, recovery, secret)
  try { return wrapDataKey(envelope, key, password) } finally { sodium.memzero(key) }
}
