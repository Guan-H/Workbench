import { describe, expect, it } from 'vitest'
import { generatePassword, passwordCharacterSets, type PasswordCharacterKind } from './password-generator'

describe('password generation with the actual cryptographic random source', () => {
  it('honors lengths and includes every selected character class', () => {
    const kinds: PasswordCharacterKind[] = ['uppercase', 'lowercase', 'digits', 'symbols']
    const pool = kinds.map(kind => passwordCharacterSets[kind]).join('')
    for (const length of [8, 20, 128]) {
      for (let iteration = 0; iteration < 20; iteration++) {
        const password = generatePassword({ length, kinds })
        expect(password).toHaveLength(length)
        expect([...password].every(character => pool.includes(character))).toBe(true)
        for (const kind of kinds) expect([...password].some(character => passwordCharacterSets[kind].includes(character))).toBe(true)
      }
    }
  })

  it('generates only the requested class and handles duplicate selections', () => {
    for (const kind of ['uppercase', 'lowercase', 'digits', 'symbols'] satisfies PasswordCharacterKind[]) {
      const password = generatePassword({ length: 20, kinds: [kind, kind] })
      expect(password).toHaveLength(20)
      expect([...password].every(character => passwordCharacterSets[kind].includes(character))).toBe(true)
    }
  })

  it('rejects invalid lengths and an empty selection', () => {
    for (const length of [0, 7, 129, NaN, Infinity, 20.5]) {
      expect(() => generatePassword({ length, kinds: ['digits'] })).toThrow(RangeError)
    }
    expect(() => generatePassword({ length: 20, kinds: [] })).toThrow(RangeError)
  })
})
