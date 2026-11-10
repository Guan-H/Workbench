import { describe, expect, it } from 'vitest'
import { parseRecovery, parseRecoveryStatus } from './recovery-format'

const encode = (length: number) => btoa('x'.repeat(length)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const valid = { format: 'private-space-vault-recovery', version: 1, vaultId: '643e6c88-7698-43cb-bdd8-d27e8cc3ba66',
  keyId: '8e08c6c4-54f4-46db-9ee7-b29f6397f792', id: '237f3223-d7be-4b4b-8ea9-2b58055f5e08', nonce: encode(24), ciphertext: encode(48) }
describe('recovery format boundary, not cryptographic authentication', () => {
  it('accepts only the declared version, identities and fixed-size wrapper', () => {
    expect(parseRecovery(valid)).toEqual(valid)
    for (const invalid of [{ ...valid, version: 2 }, { ...valid, nonce: encode(23) }, { ...valid, ciphertext: encode(49) },
      { ...valid, id: 'bad-id' }, { ...valid, secret: 'must-not-be-persisted' }, { ...valid, ciphertext: valid.ciphertext + '=' }]) {
      expect(() => parseRecovery(invalid)).toThrow()
    }
  })
  it('rejects contradictory status and invalid version metadata', () => {
    expect(parseRecoveryStatus({ enabled: false, version: '1', recovery: null }).enabled).toBe(false)
    expect(parseRecoveryStatus({ enabled: true, version: '2', recovery: valid }).enabled).toBe(true)
    expect(() => parseRecoveryStatus({ enabled: false, version: '1', recovery: valid })).toThrow()
    expect(() => parseRecoveryStatus({ enabled: true, version: '01', recovery: valid })).toThrow()
  })
})
