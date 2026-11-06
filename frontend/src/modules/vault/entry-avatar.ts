import { isEntryIconId, type EntryIconId } from './entry-icons'

export interface CustomEntryAvatar { kind: 'custom'; dataUrl: string }
export type EntryAvatar = EntryIconId | CustomEntryAvatar
export const maxAvatarBytes = 32768
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 33 || !pngSignature.every((byte, index) => bytes[index] === byte)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return undefined
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
/** Parse only bounded PNG thumbnails; neither URLs, SVG nor arbitrary data URIs are supported. */
export function parseEntryAvatar(input: unknown): EntryAvatar {
  if (isEntryIconId(input)) return input
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('kind' in input) || input.kind !== 'custom'
    || !('dataUrl' in input) || typeof input.dataUrl !== 'string' || Object.keys(input).sort().join(',') !== 'dataUrl,kind') throw new Error('INVALID_ENTRY_AVATAR')
  const prefix = 'data:image/png;base64,'
  if (!input.dataUrl.startsWith(prefix) || input.dataUrl.length > prefix.length + 4 * Math.ceil(maxAvatarBytes / 3)) throw new Error('INVALID_ENTRY_AVATAR')
  const encoded = input.dataUrl.slice(prefix.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) throw new Error('INVALID_ENTRY_AVATAR')
  let binary: string
  try { binary = atob(encoded) } catch { throw new Error('INVALID_ENTRY_AVATAR') }
  if (binary.length > maxAvatarBytes || btoa(binary) !== encoded) throw new Error('INVALID_ENTRY_AVATAR')
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const size = pngSize(bytes)
  const ending = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]
  if (!size || size.width < 1 || size.width > 128 || size.width !== size.height
    || !ending.every((byte, index) => bytes[bytes.length - ending.length + index] === byte)) throw new Error('INVALID_ENTRY_AVATAR')
  return { kind: 'custom', dataUrl: input.dataUrl }
}
