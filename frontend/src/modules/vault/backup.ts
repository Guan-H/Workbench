import { parseEnvelope, type BackupEnvelope } from './envelope-format'

export interface VaultBackup { format: 'private-space-vault-backup'; version: 1; envelope: BackupEnvelope }
export interface BackupSummary { total: number; login: number; secureNote: number; deleted: number }
export const maxBackupBytes = 2 * 1024 * 1024

export async function parseBackup(input: unknown): Promise<VaultBackup> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !('format' in input) || input.format !== 'private-space-vault-backup'
    || !('version' in input) || input.version !== 1 || !('envelope' in input)
    || Object.keys(input).sort().join(',') !== 'envelope,format,version') throw new Error('INVALID_VAULT_BACKUP')
  return { format: 'private-space-vault-backup', version: 1, envelope: await parseEnvelope(input.envelope, 'backup') }
}
