export interface VaultField { id: string; label: string; value: string; hidden: boolean }
export interface VaultEntry {
  id: string; type: 'login'; name: string; urls: string[]; username: string; password: string
  notes: string; tags: string[]; favorite: boolean; fields: VaultField[]; createdAt: string; updatedAt: string
}
export interface VaultContent { format: 'private-space-vault-content'; version: 1; entries: VaultEntry[] }
export interface VaultDraft {
  format: 'private-space-vault-draft-content'; version: 1; baseVersion: string; entry: VaultEntry; original: VaultEntry | null
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function invalid(): never { throw new Error('INVALID_VAULT_CONTENT') }
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) invalid()
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
export function parseEntry(input: unknown, incomplete = false): VaultEntry {
  const value = object(input, ['id', 'type', 'name', 'urls', 'username', 'password', 'notes', 'tags', 'favorite', 'fields', 'createdAt', 'updatedAt'])
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
    favorite: boolean(value.favorite), fields, createdAt: date(value.createdAt), updatedAt: date(value.updatedAt) }
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
  if (original && original.id !== entry.id) invalid()
  return { format: 'private-space-vault-draft-content', version: 1, baseVersion, entry, original }
}
export function newEntry(): VaultEntry {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), type: 'login', name: '', urls: [], username: '', password: '', notes: '', tags: [],
    favorite: false, fields: [], createdAt: now, updatedAt: now }
}
export function replaceEntry(entries: VaultEntry[], entry: VaultEntry): VaultEntry[] {
  const result = entries.map(item => item.id === entry.id ? entry : item)
  if (!entries.some(item => item.id === entry.id)) result.unshift(entry)
  return result
}
