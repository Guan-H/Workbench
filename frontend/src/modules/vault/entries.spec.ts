import { describe, expect, it } from 'vitest'
import { draftAction, entrySearchText, moveEntryToTrash, newEntry, parseContent, parseDraft, parseEntry, rebaseDraft, restoreEntry, summarizeDraft, type VaultDraft } from './entries'

describe('vault entry variants', () => {
  it('reads existing login snapshots alongside secure notes without adding login fields to notes', () => {
    const login = { ...newEntry(), name: 'test login' }
    const note = { ...newEntry('secure-note'), name: 'test note', body: '# test body' }
    const content = { format: 'private-space-vault-content', version: 1, entries: [login, note] }
    expect(parseContent(content)).toEqual(content)
    expect(parseEntry(note)).not.toHaveProperty('password')
    expect(entrySearchText(parseEntry(note))).toContain('# test body')
  })
  it('rejects missing, oversized, hybrid and unknown note data', () => {
    const note = { ...newEntry('secure-note'), name: 'test note' }
    for (const invalid of [{ ...note, body: undefined }, { ...note, body: 'x'.repeat(65537) }, { ...note, urls: [] }, { ...note, type: 'unknown' }]) {
      expect(() => parseEntry(invalid)).toThrow('INVALID_VAULT_CONTENT')
    }
  })
  it('accepts incomplete encrypted note drafts and rejects changing an existing entry type', () => {
    const entry = newEntry('secure-note')
    const draft = { format: 'private-space-vault-draft-content', version: 1, baseVersion: '1', entry, original: null }
    expect(parseDraft(draft)).toEqual(draft)
    expect(() => parseEntry(entry)).toThrow()
    expect(() => parseDraft({ ...draft, original: { ...newEntry(), id: entry.id, name: 'login' } })).toThrow()
  })
})

describe('encrypted vault trash transitions', () => {
  it('preserves IDs and all content when deleting and restoring either type', () => {
    for (const type of ['login', 'secure-note'] as const) {
      const entry = parseEntry({ ...newEntry(type), name: 'test content', favorite: true })
      const deleted = parseEntry(moveEntryToTrash(entry))
      expect(deleted.deletedAt).toBeDefined()
      expect(entry.deletedAt).toBeUndefined()
      const restored = parseEntry(restoreEntry(deleted))
      expect({ ...restored, updatedAt: entry.updatedAt }).toEqual(entry)
      expect(() => moveEntryToTrash(deleted)).toThrow('ENTRY_ALREADY_DELETED')
      expect(() => restoreEntry(entry)).toThrow('ENTRY_NOT_DELETED')
    }
  })
  it('strictly validates encrypted deletion metadata and pending transitions', () => {
    const original = parseEntry({ ...newEntry(), name: 'test login' })
    const entry = moveEntryToTrash(original)
    const draft: VaultDraft = { format: 'private-space-vault-draft-content', version: 1, baseVersion: '1', original, entry }
    expect(draftAction(parseDraft(draft).entry, original)).toBe('delete')
    expect(draftAction(restoreEntry(entry), entry)).toBe('restore')
    for (const deletedAt of [null, undefined, 'invalid', '2026-11-06']) expect(() => parseEntry({ ...original, deletedAt })).toThrow()
    expect(() => parseDraft({ ...draft, original: null })).toThrow()
    expect(() => parseDraft({ ...draft, original: entry })).toThrow()
  })
  it('uses reviewed current content for a stale delete or restore and prevents implicit resurrection', () => {
    const original = parseEntry({ ...newEntry('secure-note'), name: 'test note', body: 'old content' })
    const draft: VaultDraft = { format: 'private-space-vault-draft-content', version: 1, baseVersion: '1', original, entry: moveEntryToTrash(original) }
    const current = { ...original, type: 'secure-note', body: 'new server content' } as const
    const rebased = rebaseDraft(draft, current, '2')
    expect(rebased.entry).toMatchObject({ body: 'new server content', deletedAt: expect.any(String) })
    const restored = rebaseDraft({ ...draft, original: rebased.entry, entry: restoreEntry(rebased.entry) }, rebased.entry, '3')
    expect(restored.entry).toMatchObject({ body: 'new server content' })
    expect(restored.entry.deletedAt).toBeUndefined()
    expect(() => rebaseDraft({ ...draft, entry: original }, rebased.entry, '3')).toThrow('ENTRY_DELETED')
    expect(() => rebaseDraft(draft, rebased.entry, '3')).toThrow('ENTRY_ALREADY_DELETED')
  })
})

describe('draft box summaries', () => {
  it('exposes only a title, type and action after decryption, never password or body fields', () => {
    const entry = parseEntry({ ...newEntry(), name: 'test title', password: 'PRIVATE_TEST_SECRET' })
    const draft: VaultDraft = { format: 'private-space-vault-draft-content', version: 1, baseVersion: '1', entry, original: null }
    expect(summarizeDraft(draft)).toEqual({ name: 'test title', type: 'login', action: 'new' })
    expect(JSON.stringify(summarizeDraft(draft))).not.toContain('PRIVATE_TEST_SECRET')
    expect(summarizeDraft({ ...draft, original: entry }).action).toBe('edit')
    const deleted = moveEntryToTrash(entry)
    expect(summarizeDraft({ ...draft, entry: deleted, original: entry }).action).toBe('delete')
    expect(summarizeDraft({ ...draft, entry, original: deleted }).action).toBe('restore')
  })
})
