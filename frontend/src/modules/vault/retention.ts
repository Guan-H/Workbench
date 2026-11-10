import type { VaultEntry } from './entries'
import type { VaultEnvelope } from './envelope-format'

export interface VaultRetentionPolicy { enabled: boolean; historyDays: number; recycleDays: number; serverTime: string; trashCutoff: string }
export interface HistoryItem { version: string; createdAt: string; operationKind: string | null }
export interface HistoryPage { items: HistoryItem[]; total: number; page: number; pageSize: number; anchor: string; currentVersion: string }
export type RestoreSource = { kind: 'history'; version: string; envelope: VaultEnvelope } | { kind: 'cleanup'; cutoff: string }
export type ExpiredTrashItem = Pick<VaultEntry, 'id' | 'name' | 'type'> & { deletedAt: string }
export function expiredTrash(entries: VaultEntry[], cutoff: string): ExpiredTrashItem[] {
  const limit = Date.parse(cutoff)
  if (!Number.isFinite(limit)) throw new Error('INVALID_RETENTION_CUTOFF')
  return entries.flatMap(item => item.deletedAt && Date.parse(item.deletedAt) < limit
    ? [{ id: item.id, name: item.name, type: item.type, deletedAt: item.deletedAt }] : [])
}
