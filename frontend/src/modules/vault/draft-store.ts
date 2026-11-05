import type { EncryptedDraft } from './envelope'
import type { PendingVaultSave } from './types'

export interface VaultDraftRecord { id: string; vaultId: string; updatedAt: string; envelope: EncryptedDraft; pending?: PendingVaultSave }
let database: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('private-space-vault-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' })
    request.onerror = () => { database = undefined; reject(new Error('无法打开本机加密草稿存储。')) }
    request.onblocked = () => { database = undefined; reject(new Error('草稿存储被其他页面占用，请关闭旧页面后重试。')) }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = undefined }
      resolve(db)
    }
  })
  return database
}
/** Resolve only when the real IndexedDB transaction commits, not just when put succeeds. */
export async function putVaultDraft(record: VaultDraftRecord): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    tx.objectStore('drafts').put(JSON.parse(JSON.stringify(record)))
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(new Error('加密草稿写入失败，请检查本机存储空间或浏览器权限。'))
  })
}
export async function listVaultDrafts(vaultId: string): Promise<VaultDraftRecord[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly')
    const request = tx.objectStore('drafts').getAll()
    tx.oncomplete = () => resolve((request.result as VaultDraftRecord[]).filter(record => record.vaultId === vaultId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    tx.onabort = tx.onerror = () => reject(new Error('读取本机加密草稿失败。'))
  })
}
export async function removeVaultDraft(id: string, expectedPayloadId: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    const store = tx.objectStore('drafts')
    const request = store.get(id)
    request.onsuccess = () => {
      const record = request.result as VaultDraftRecord | undefined
      // Another tab may have saved a newer revision; never delete it with an older confirmation.
      if (record?.envelope.payload.id === expectedPayloadId) store.delete(id)
    }
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(new Error('清理本机加密草稿失败。'))
  })
}
