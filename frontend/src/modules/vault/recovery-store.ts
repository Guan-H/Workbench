import { parseEnvelope, type VaultEnvelope } from './envelope-format'
import { parseRecovery, type RecoveryEnvelope } from './recovery-format'
import { readVaultRequest, storeVaultRequest } from './restore-store'

type Candidate = { baseVersion: string; operation: string; envelope: VaultEnvelope }
export type PendingRecovery = Candidate & ({ mode: 'configure-recovery'; recovery: RecoveryEnvelope } | { mode: 'reset-master'; recoveryId: string })
export async function readRecoveryRequest(account: string): Promise<PendingRecovery | undefined> {
  const value = await readVaultRequest(account)
  if (value === undefined) return
  if (!value || typeof value !== 'object' || !('mode' in value)) throw new Error('本机待确认请求异常，请保留浏览器数据并核对。')
  if (value.mode === 'create' || value.mode === 'replace') return
  if (!('baseVersion' in value) || typeof value.baseVersion !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value.baseVersion)
    || !('operation' in value) || typeof value.operation !== 'string' || !/^[0-9a-f-]{36}$/.test(value.operation) || !('envelope' in value)) {
    throw new Error('本机恢复密钥请求异常，请保留浏览器数据并核对。')
  }
  const candidate = { baseVersion: value.baseVersion, operation: value.operation, envelope: await parseEnvelope(value.envelope) }
  if (value.mode === 'configure-recovery' && 'recovery' in value) return { ...candidate, mode: 'configure-recovery', recovery: parseRecovery(value.recovery) }
  if (value.mode === 'reset-master' && 'recoveryId' in value && typeof value.recoveryId === 'string' && /^[0-9a-f-]{36}$/.test(value.recoveryId)) {
    return { ...candidate, mode: 'reset-master', recoveryId: value.recoveryId }
  }
  throw new Error('本机恢复密钥请求类型异常，请保留浏览器数据并核对。')
}
export const storeRecoveryRequest = (account: string, value: PendingRecovery, remove = false): Promise<void> => storeVaultRequest(account, value, remove)
