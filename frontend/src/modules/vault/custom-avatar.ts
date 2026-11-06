import { maxAvatarBytes, parseEntryAvatar, pngSize, type CustomEntryAvatar } from './entry-avatar'

function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return undefined
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return undefined
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) return undefined
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return undefined
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) }
    }
    offset += length
  }
  return undefined
}
export async function createCustomAvatar(file: File): Promise<CustomEntryAvatar> {
  if (!file.size || file.size > 2 * 1024 * 1024) throw new Error('请选择不超过 2 MiB 的 PNG 或 JPEG 图片。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const size = pngSize(bytes) ?? jpegSize(bytes)
  if (!size || !size.width || !size.height) throw new Error('图片格式不支持或文件已损坏，仅支持 PNG 和 JPEG。')
  if (size.width > 4096 || size.height > 4096 || size.width * size.height > 12000000) throw new Error('图片尺寸过大，请先缩小至 4096 像素以内且不超过 1200 万像素。')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('无法读取此图片，请换一张 PNG 或 JPEG 图片。') }
  try {
    for (const edge of [128, 96, 64]) {
      const canvas = document.createElement('canvas')
      canvas.width = edge; canvas.height = edge
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法处理图片，请检查浏览器后重试。')
      const scale = Math.min(edge / bitmap.width, edge / bitmap.height)
      const width = bitmap.width * scale, height = bitmap.height * scale
      context.drawImage(bitmap, (edge - width) / 2, (edge - height) / 2, width, height)
      // Re-encode pixels, preserving the whole picture while discarding source metadata and animation.
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob || blob.size > maxAvatarBytes) continue
      const binary = String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))
      const result = parseEntryAvatar({ kind: 'custom', dataUrl: 'data:image/png;base64,' + btoa(binary) })
      if (typeof result === 'string') throw new Error('图片处理失败，请重试。')
      return result
    }
    throw new Error('处理后的头像仍然过大，请选择更简单的图片。')
  } finally { bitmap.close() }
}
