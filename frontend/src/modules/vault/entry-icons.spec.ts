import { describe, expect, it } from 'vitest'
import { entryIcons, isEntryIconId } from './entry-icons'
import { entryIconDataUrl } from './entry-icon-assets'
import { moveEntryToTrash, newEntry, parseContent, parseEntry, restoreEntry } from './entries'
import { parseEntryAvatar, type CustomEntryAvatar } from './entry-avatar'

const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('vault platform avatars', () => {
  it('migrates old custom avatars, deduplicates reuse, and retains the gallery when entries are purged', () => {
    const avatar: CustomEntryAvatar = { kind: 'custom', dataUrl: testPng }
    const entry = { ...newEntry(), name: 'first', icon: avatar }
    const content = parseContent({ format: 'private-space-vault-content', version: 1, entries: [entry, { ...entry, id: crypto.randomUUID() }] })
    expect(content.avatars).toEqual([avatar])
    expect(parseContent({ ...content, entries: [] }).avatars).toEqual([avatar])
    expect(() => parseContent({ ...content, avatars: ['youtube'] })).toThrow('INVALID_VAULT_CONTENT')
    expect(() => parseContent({ ...content, avatars: [{ kind: 'custom', dataUrl: 'https://example.invalid' }] })).toThrow('INVALID_VAULT_CONTENT')
  })
  it('bundles all 25 choices as real local SVGs without active or remote resources', () => {
    expect(entryIcons).toHaveLength(25)
    expect(new Set(entryIcons.map(icon => icon.id)).size).toBe(25)
    for (const icon of entryIcons) {
      const source = entryIconDataUrl(icon.id)
      expect(source).toMatch(/^data:image\/svg\+xml,/)
      const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1))
      expect(svg).toContain('<path')
      expect(svg).not.toMatch(/<(script|image|foreignObject|use)\b|\b(href|src|onload)\s*=/i)
    }
    for (const id of ['x', 'youtube', 'bilibili', 'weibo', 'douyin', 'tiktok', 'google', 'chatgpt', 'gemini', 'claude', 'deepseek', 'perplexity']) expect(isEntryIconId(id)).toBe(true)
  })
  it('preserves chosen icons in both entry types through deletion and recovery, leaving legacy entries unchanged', () => {
    for (const type of ['login', 'secure-note'] as const) {
      const legacy = { ...newEntry(type), name: 'test entry' }
      expect(parseEntry(legacy)).toEqual(legacy)
      expect(parseEntry(legacy)).not.toHaveProperty('icon')
      const entry = parseEntry({ ...legacy, icon: 'youtube' })
      expect(parseEntry(restoreEntry(moveEntryToTrash(entry))).icon).toBe('youtube')
      for (const icon of [undefined, null, 'unknown', 'https://example.invalid/icon.svg']) expect(() => parseEntry({ ...legacy, icon })).toThrow()
    }
  })
  it('validates bounded custom thumbnails and preserves them through encrypted entry transitions', () => {
    const icon: CustomEntryAvatar = { kind: 'custom', dataUrl: testPng }
    expect(parseEntryAvatar(icon)).toEqual(icon)
    for (const type of ['login', 'secure-note'] as const) {
      const entry = parseEntry({ ...newEntry(type), name: 'test custom', icon })
      expect(parseEntry(restoreEntry(moveEntryToTrash(entry))).icon).toEqual(icon)
    }
  })
  it('rejects remote URLs, SVG, wrong types, excessive bytes and invalid thumbnail dimensions', () => {
    const bytes = Uint8Array.from(atob(testPng.split(',')[1]!), character => character.charCodeAt(0))
    new DataView(bytes.buffer).setUint32(16, 4096)
    const largeDimensions = 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes))
    for (const dataUrl of ['https://example.invalid/avatar.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,AAAA', largeDimensions, testPng + 'A'.repeat(45000)]) {
      expect(() => parseEntryAvatar({ kind: 'custom', dataUrl })).toThrow('INVALID_ENTRY_AVATAR')
    }
    expect(() => parseEntryAvatar({ kind: 'custom', dataUrl: testPng, url: 'extra' })).toThrow()
    expect(() => parseEntryAvatar({ kind: 'url', dataUrl: testPng })).toThrow()
  })
})
