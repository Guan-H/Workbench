import { parseEnvelope, type VaultEnvelope } from './envelope-format'

type RestoreTarget = { mode: 'create' } | { mode: 'replace'; baseVersion: string }
export type PendingRestore = RestoreTarget & { operation: string; envelope: VaultEnvelope; source?: 'history' | 'cleanup' }
let database: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('private-space-vault-restores', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('requests')
    request.onerror = request.onblocked = () => { database = undefined; reject(new Error('无法打开本机恢复请求存储，请检查浏览器权限。')) }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = undefined }
      resolve(db)
    }
  })
  return database
}
export async function readVaultRequest(account: string): Promise<unknown> {
  const db = await open()
  const value: unknown = await new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readonly')
    const request = tx.objectStore('requests').get(account)
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = tx.onerror = () => reject(new Error('无法读取恢复请求。'))
  })
  return value
}
export async function readRestore(account: string): Promise<PendingRestore | undefined> {
  const value = await readVaultRequest(account)
  if (value === undefined) return
  if (value && typeof value === 'object' && 'mode' in value && (value.mode === 'configure-recovery' || value.mode === 'reset-master')) return
  if (!value || typeof value !== 'object' || !('mode' in value) || !('operation' in value) || !('envelope' in value)
    || typeof value.operation !== 'string' || !/^[0-9a-f-]{36}$/.test(value.operation)) throw new Error('本机恢复请求格式异常，请保留浏览器数据并核对。')
  const envelope = await parseEnvelope(value.envelope)
  const source: Pick<PendingRestore, 'source'> = 'source' in value && (value.source === 'history' || value.source === 'cleanup') ? { source: value.source } : {}
  if (value.mode === 'create') return { mode: 'create', operation: value.operation, envelope }
  if (value.mode === 'replace' && 'baseVersion' in value && typeof value.baseVersion === 'string' && /^[1-9][0-9]{0,18}$/.test(value.baseVersion)) {
    return { mode: 'replace', baseVersion: value.baseVersion, operation: value.operation, envelope, ...source }
  }
  throw new Error('本机恢复请求格式异常，请保留浏览器数据并核对。')
}

/** One pending request per account; a second tab must not overwrite or delete another operation. */
export async function storeVaultRequest(account: string, candidate: { operation: string }, remove = false): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite')
    const store = tx.objectStore('requests')
    const request = store.get(account)
    let conflict = false
    request.onsuccess = () => {
      const current: unknown = request.result
      if (current && (typeof current !== 'object' || !('operation' in current) || current.operation !== candidate.operation)) {
        conflict = true; tx.abort(); return
      }
      if (remove) store.delete(account)
      else store.put(JSON.parse(JSON.stringify(candidate)), account)
    }
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(new Error(conflict ? '其他页面已有待确认恢复，请先核对；本次未覆盖该请求。' : '恢复请求暂存失败，尚未确认可安全提交，请检查本机存储。'))
  })
}

export const storeRestore = (account: string, candidate: PendingRestore, remove = false): Promise<void> => storeVaultRequest(account, candidate, remove)
