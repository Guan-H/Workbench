import { describe, expect, it } from 'vitest'
import { parseEnvelope } from './envelope-format'
import { parseBackup } from './backup'

// Structural fixtures test parsing only; authenticated encryption is exercised by the real Worker suite.
const encode = (size: number) => btoa('\0'.repeat(size)).replace(/=+$/, '')
function fixture() {
  return { format: 'private-space-vault', version: 1, purpose: 'backup', vaultId: '10000000-0000-4000-8000-000000000001',
    keyId: '10000000-0000-4000-8000-000000000002', kdf: { algorithm: 'argon2id13', ops: 3, memory: 67108864, salt: encode(16) },
    wrappedKey: { nonce: encode(24), ciphertext: encode(48) }, payload: { id: '10000000-0000-4000-8000-000000000003', nonce: encode(24), ciphertext: encode(16) } }
}
describe('encrypted envelope boundary', () => {
  it('isolates backup, vault and draft purposes', async () => {
    const input = fixture()
    expect(await parseEnvelope(input, 'backup')).toEqual(input)
    await expect(parseEnvelope(input)).rejects.toThrow()
    await expect(parseEnvelope(input, 'draft')).rejects.toThrow()
    await expect(parseBackup({ format: 'private-space-vault-backup', version: 1, envelope: input })).resolves.toMatchObject({ version: 1 })
  })
  it('rejects unsupported versions, KDF allocations and extra fields', async () => {
    const input = fixture()
    for (const changed of [
      { ...input, version: 2 }, { ...input, format: 'private-space-candidate' }, { ...input, password: 'never accepted' },
      { ...input, kdf: { ...input.kdf, memory: 1073741824 } }, { ...input, kdf: { ...input.kdf, ops: 100 } },
      { ...input, wrappedKey: { ...input.wrappedKey, extra: true } },
    ]) await expect(parseEnvelope(changed, 'backup')).rejects.toThrow()
  })
  it('rejects noncanonical base64, oversized ciphertext and invalid IDs', async () => {
    const input = fixture()
    for (const changed of [
      { ...input, vaultId: '../anything' }, { ...input, kdf: { ...input.kdf, salt: encode(16) + '==' } },
      { ...input, kdf: { ...input.kdf, salt: encode(16).slice(0, -1) + 'B' } },
      { ...input, payload: { ...input.payload, ciphertext: 'A'.repeat(1400000) } },
    ]) await expect(parseEnvelope(changed, 'backup')).rejects.toThrow()
  })
})
