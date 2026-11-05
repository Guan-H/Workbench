export const passwordCharacterSets = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
} as const

export type PasswordCharacterKind = keyof typeof passwordCharacterSets
export interface PasswordOptions { length: number; kinds: readonly PasswordCharacterKind[] }

function randomIndex(bound: number): number {
  const range = 0x100000000
  const limit = range - range % bound
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]!
  } while (value >= limit)
  buffer.fill(0)
  return value % bound
}

/** Local CSPRNG generation; rejection sampling avoids bias from a direct modulo. */
export function generatePassword(options: PasswordOptions): string {
  if (!Number.isInteger(options.length) || options.length < 8 || options.length > 128) {
    throw new RangeError('密码长度须为 8–128 位整数。')
  }
  const kinds = [...new Set(options.kinds)]
  if (!kinds.length || kinds.some(kind => !Object.hasOwn(passwordCharacterSets, kind))) {
    throw new RangeError('请至少选择一种字符类型。')
  }
  const groups = kinds.map(kind => passwordCharacterSets[kind])
  const characters = groups.join('')
  const result = groups.map(group => group[randomIndex(group.length)]!)
  while (result.length < options.length) result.push(characters[randomIndex(characters.length)]!)
  // Required characters must not occupy predictable positions at the start.
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1)
    const previous = result[index]!
    result[index] = result[other]!
    result[other] = previous
  }
  return result.join('')
}
