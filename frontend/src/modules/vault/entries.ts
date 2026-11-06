import { parseEntryAvatar, type EntryAvatar } from './entry-avatar'

export interface VaultField { id: string; label: string; value: string; hidden: boolean }
interface VaultEntryBase { id: string; name: string; tags: string[]; favorite: boolean; createdAt: string; updatedAt: string; deletedAt?: string; icon?: EntryAvatar }
export interface VaultLogin extends VaultEntryBase { type: 'login'; urls: string[]; username: string; password: string; notes: string; fields: VaultField[] }
export interface VaultSecureNote extends VaultEntryBase { type: 'secure-note'; body: string }
export type VaultEntry = VaultLogin | VaultSecureNote
export interface VaultContent { format: 'private-space-vault-content'; version: 1; entries: VaultEntry[] }
export interface VaultDraft {
  format: 'private-space-vault-draft-content'; version: 1; baseVersion: string; entry: VaultEntry; original: VaultEntry | null
}
export interface VaultDraftSummary { name: string; type: VaultEntry['type']; action: 'new' | 'edit' | 'delete' | 'restore' }
export function summarizeDraft(draft: VaultDraft): VaultDraftSummary {
  const action = draftAction(draft.entry, draft.original)
  return { name: draft.entry.name.trim() || '未命名条目', type: draft.entry.type, action: action === 'edit' && !draft.original ? 'new' : action }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function invalid(): never { throw new Error('INVALID_VAULT_CONTENT') }
function object(value: unknown, fields: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !fields.includes(field) && !optional.includes(field))) invalid()
  return Object.fromEntries(Object.entries(value))
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) invalid()
  return value
}
function id(value: unknown): string { const result = text(value, 36); if (!uuid.test(result)) invalid(); return result }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value }
function date(value: unknown): string {
  const result = text(value, 24)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) invalid()
  return result
}
function strings(value: unknown, count: number, size: number): string[] {
  if (!Array.isArray(value) || value.length > count) invalid()
  return value.map(item => text(item, size))
}
function icon(value: Record<string, unknown>): { icon?: EntryAvatar } {
  if (!Object.hasOwn(value, 'icon')) return {}
  try { return { icon: parseEntryAvatar(value.icon) } } catch { return invalid() }
}
export function parseEntry(input: unknown, incomplete = false): VaultEntry {
  if (input && typeof input === 'object' && 'type' in input && input.type === 'secure-note') {
    const value = object(input, ['id', 'type', 'name', 'body', 'tags', 'favorite', 'createdAt', 'updatedAt'], ['deletedAt', 'icon'])
    const name = text(value.name, 240)
    if (!incomplete && !name.trim()) invalid()
    return { id: id(value.id), type: 'secure-note', name, body: text(value.body, 65536), tags: strings(value.tags, 50, 100),
      favorite: boolean(value.favorite), createdAt: date(value.createdAt), updatedAt: date(value.updatedAt),
      ...(Object.hasOwn(value, 'deletedAt') ? { deletedAt: date(value.deletedAt) } : {}), ...icon(value) }
  }
  const value = object(input, ['id', 'type', 'name', 'urls', 'username', 'password', 'notes', 'tags', 'favorite', 'fields', 'createdAt', 'updatedAt'], ['deletedAt', 'icon'])
  const name = text(value.name, 240)
  if (value.type !== 'login' || (!incomplete && !name.trim()) || !Array.isArray(value.fields) || value.fields.length > 30) invalid()
  const fields = value.fields.map(input => {
    const field = object(input, ['id', 'label', 'value', 'hidden'])
    const label = text(field.label, 120)
    if (!incomplete && !label.trim()) invalid()
    return { id: id(field.id), label, value: text(field.value, 8192), hidden: boolean(field.hidden) }
  })
  if (new Set(fields.map(field => field.id)).size !== fields.length) invalid()
  return { id: id(value.id), type: 'login', name, urls: strings(value.urls, 20, 4096), username: text(value.username, 4096),
    password: text(value.password, 8192), notes: text(value.notes, 65536), tags: strings(value.tags, 50, 100),
    favorite: boolean(value.favorite), fields, createdAt: date(value.createdAt), updatedAt: date(value.updatedAt),
    ...(Object.hasOwn(value, 'deletedAt') ? { deletedAt: date(value.deletedAt) } : {}), ...icon(value) }
}
export function parseContent(input: unknown): VaultContent {
  const value = object(input, ['format', 'version', 'entries'])
  if (value.format !== 'private-space-vault-content' || value.version !== 1 || !Array.isArray(value.entries)) invalid()
  const entries = value.entries.map(entry => parseEntry(entry))
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) invalid()
  return { format: 'private-space-vault-content', version: 1, entries }
}
export function parseDraft(input: unknown): VaultDraft {
  const value = object(input, ['format', 'version', 'baseVersion', 'entry', 'original'])
  const baseVersion = text(value.baseVersion, 19)
  if (value.format !== 'private-space-vault-draft-content' || value.version !== 1 || !/^[1-9][0-9]{0,18}$/.test(baseVersion)
    || BigInt(baseVersion) > 9223372036854775806n) invalid()
  const entry = parseEntry(value.entry, true)
  const original = value.original === null ? null : parseEntry(value.original)
  if (original && (original.id !== entry.id || original.type !== entry.type)) invalid()
  if (entry.deletedAt && (!original || original.deletedAt)) invalid()
  return { format: 'private-space-vault-draft-content', version: 1, baseVersion, entry, original }
}
export function newEntry(type: VaultEntry['type'] = 'login'): VaultEntry {
  const now = new Date().toISOString()
  if (type === 'secure-note') return { id: crypto.randomUUID(), type, name: '', body: '', tags: [], favorite: false, createdAt: now, updatedAt: now }
  return { id: crypto.randomUUID(), type: 'login', name: '', urls: [], username: '', password: '', notes: '', tags: [],
    favorite: false, fields: [], createdAt: now, updatedAt: now }
}
export function replaceEntry(entries: VaultEntry[], entry: VaultEntry): VaultEntry[] {
  const result = entries.map(item => item.id === entry.id ? entry : item)
  if (!entries.some(item => item.id === entry.id)) result.unshift(entry)
  return result
}
export function entrySearchText(entry: VaultEntry): string {
  return [entry.name, ...entry.tags, ...(entry.type === 'login' ? [entry.username, ...entry.urls, entry.notes] : [entry.body])].join('\n')
}
export function moveEntryToTrash(entry: VaultEntry): VaultEntry {
  if (entry.deletedAt) throw new Error('ENTRY_ALREADY_DELETED')
  const now = new Date().toISOString()
  return { ...entry, deletedAt: now, updatedAt: now }
}
export function restoreEntry(entry: VaultEntry): VaultEntry {
  if (!entry.deletedAt) throw new Error('ENTRY_NOT_DELETED')
  const { deletedAt: _deletedAt, ...active } = entry
  return { ...active, updatedAt: new Date().toISOString() }
}
export function draftAction(entry: VaultEntry, original: VaultEntry | null): 'edit' | 'delete' | 'restore' {
  return entry.deletedAt ? 'delete' : original?.deletedAt ? 'restore' : 'edit'
}
/** Destructive actions use the latest reviewed server content, never the stale draft's fields. */
export function rebaseDraft(draft: VaultDraft, current: VaultEntry | undefined, version: string): VaultDraft {
  if (!current || current.id !== draft.entry.id || current.type !== draft.entry.type) throw new Error('ENTRY_MISSING')
  const action = draftAction(draft.entry, draft.original)
  if (action === 'delete' && current.deletedAt) throw new Error('ENTRY_ALREADY_DELETED')
  if (action === 'restore' && !current.deletedAt) throw new Error('ENTRY_ALREADY_RESTORED')
  if (action === 'edit' && current.deletedAt) throw new Error('ENTRY_DELETED')
  return { ...draft, baseVersion: version, original: current,
    entry: action === 'delete' ? moveEntryToTrash(current) : action === 'restore' ? restoreEntry(current) : draft.entry }
}
