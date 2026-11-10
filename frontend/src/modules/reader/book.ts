export interface ReadingLocator { v: 1; part: string; block: number; offset: number; encoding: string; quote?: string; quoteOffset?: number; chapter?: string }
export interface ReadingBlock { part: string; index: number; text: string; heading: boolean; image?: string }
export interface ReadingChapter { key: string; title: string; location?: ReadingLocator; children?: ReadingChapter[] }
export interface ReadingChunk { blocks: ReadingBlock[]; characters: number }
export interface ReadingBook {
  chunks: ReadingChunk[]
  chapters: ReadingChapter[]
  warning: string
  image?: (path: string) => Promise<Blob>
  close: () => void
}

export const chapterTitle = (line: string) => /^(?:第[零〇一二三四五六七八九十百千万两\d]{1,16}[卷章节回部篇](?:\s.{0,70}|[^\p{L}\p{N}].{0,70})?|(?:序章|序言|楔子|引子|尾声|后记|番外)(?:[\s：:（(].{0,70})?)$/u.test(line.trim())

export function chunksFrom(blocks: ReadingBlock[]): ReadingChunk[] {
  const chunks: ReadingChunk[] = []
  let current: ReadingBlock[] = [], characters = 0
  for (const block of blocks) {
    if (current.length && (characters + block.text.length > 6000 || current.length >= 45)) {
      chunks.push({ blocks: current, characters }); current = []; characters = 0
    }
    current.push(block); characters += Math.max(block.text.length, block.image ? 200 : 1)
  }
  if (current.length) chunks.push({ blocks: current, characters })
  return chunks
}

export function textBook(bytes: Uint8Array, requested: string): ReadingBook {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'UTF-8'
    : bytes[0] === 0xff && bytes[1] === 0xfe ? 'UTF-16LE' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'UTF-16BE' : 'UTF-8'
  const encoding = requested === 'auto' ? bom : requested
  let text: string
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { throw new Error('无法按所选编码读取书籍，请切换正确编码；原文件没有修改。') }
  const blocks: ReadingBlock[] = [], chapters: ReadingChapter[] = []
  let volume: ReadingChapter | undefined
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const value = line.trim()
    if (!value) continue
    const heading = value.length <= 90 && chapterTitle(value)
    const index = blocks.length
    // Bounded text nodes also give very long unbroken lines stable logical offsets.
    for (let offset = 0; offset < value.length; offset += 1800) blocks.push({ part: 'text', index: blocks.length, text: value.slice(offset, offset + 1800), heading: heading && offset === 0 })
    if (heading) {
      const chapter: ReadingChapter = { key: `text:${index}`, title: value, location: { v: 1, part: 'text', block: index, offset: 0, encoding } }
      if (/^第.+[卷部篇](?:\s|$)/.test(value)) { volume = chapter; chapters.push(chapter) }
      else if (volume) (volume.children ||= []).push(chapter)
      else chapters.push(chapter)
    }
    if (blocks.length > 250000) throw new Error('书籍段落过多，超过本次阅读保护限制，请拆分后阅读。')
  }
  if (!blocks.length) blocks.push({ part: 'text', index: 0, text: '（空白文本）', heading: false })
  return { chunks: chunksFrom(blocks), chapters, warning: chapters.length ? '' : '未识别到章节标题，仍可连续阅读和保存位置。', close() {} }
}

export function parseLocator(value: string | null): ReadingLocator | undefined {
  if (!value) return
  try {
    const item: unknown = JSON.parse(value)
    if (!item || typeof item !== 'object') return
    const loc = item as ReadingLocator
    if (loc.v === 1 && typeof loc.part === 'string' && loc.part.length <= 1024 && Number.isSafeInteger(loc.block) && loc.block >= 0
      && Number.isSafeInteger(loc.offset) && loc.offset >= 0 && ['auto','UTF-8','GB18030','UTF-16LE','UTF-16BE'].includes(loc.encoding)) return loc
  } catch { /* Invalid browser storage is never submitted as a reading position. */ }
}
