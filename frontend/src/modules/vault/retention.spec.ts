import { describe, expect, it } from 'vitest'
import { expiredTrash } from './retention'
import type { VaultSecureNote } from './entries'

const cutoff = '2026-10-10T12:00:00.000Z'
function entry(id: string, deletedAt?: string): VaultSecureNote {
  return { id, type: 'secure-note', name: id, body: '', tags: [], favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...(deletedAt ? { deletedAt } : {}) }
}
describe('vault trash expiry', () => {
  it('includes only deleted entries strictly older than the server cutoff', () => {
    const items = [entry('active'), entry('old', '2026-10-10T11:59:59.999Z'), entry('boundary', cutoff), entry('recent', '2026-10-11T00:00:00.000Z'), entry('future', '2100-01-01T00:00:00.000Z')]
    expect(expiredTrash(items, cutoff).map(item => item.id)).toEqual(['old'])
    expect(items).toHaveLength(5)
  })
  it('returns summaries without secret bodies and rejects an invalid cutoff', () => {
    expect(Object.keys(expiredTrash([entry('old', '2026-01-01T00:00:00.000Z')], cutoff)[0]!).sort()).toEqual(['deletedAt', 'id', 'name', 'type'])
    expect(() => expiredTrash([], 'invalid')).toThrow('INVALID_RETENTION_CUTOFF')
  })
})
