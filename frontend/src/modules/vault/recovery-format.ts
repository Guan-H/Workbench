export interface RecoveryEnvelope {
  format: 'private-space-vault-recovery'
  version: 1
  vaultId: string
  keyId: string
  id: string
  nonce: string
  ciphertext: string
}
export type RecoveryStatus = { enabled: false; version: string; recovery: null }
  | { enabled: true; version: string; recovery: RecoveryEnvelope }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function invalid(): never { throw new Error('恢复信息格式不正确，请保留原数据并重新读取。') }
function encoded(value: unknown, length: number): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 64) return invalid()
  let bytes: string
  try { bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/')) } catch { return invalid() }
  if (bytes.length !== length || btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== value) return invalid()
  return value
}
export function parseRecovery(value: unknown): RecoveryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'ciphertext,format,id,keyId,nonce,vaultId,version'
    || !('format' in value) || value.format !== 'private-space-vault-recovery'
    || !('version' in value) || value.version !== 1 || !('vaultId' in value) || typeof value.vaultId !== 'string' || !uuid.test(value.vaultId)
    || !('keyId' in value) || typeof value.keyId !== 'string' || !uuid.test(value.keyId)
    || !('id' in value) || typeof value.id !== 'string' || !uuid.test(value.id)
    || !('nonce' in value) || !('ciphertext' in value)) return invalid()
  return { format: 'private-space-vault-recovery', version: 1, vaultId: value.vaultId, keyId: value.keyId, id: value.id,
    nonce: encoded(value.nonce, 24), ciphertext: encoded(value.ciphertext, 48) }
}
export function parseRecoveryStatus(value: unknown): RecoveryStatus {
  if (!value || typeof value !== 'object' || !('version' in value) || typeof value.version !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value.version)
    || !('enabled' in value) || !('recovery' in value)) return invalid()
  if (value.enabled === false && value.recovery === null) return { enabled: false, version: value.version, recovery: null }
  if (value.enabled === true) return { enabled: true, version: value.version, recovery: parseRecovery(value.recovery) }
  return invalid()
}
