import { Uint8ArrayReader, ZipReader, type FileEntry } from '@zip.js/zip.js/index-native.js'
import { chunksFrom, type ReadingBlock, type ReadingBook, type ReadingChapter, type ReadingLocator } from './book'

/** Parse XML as inert data and emit only our text/image model. No publisher HTML, CSS or scripts enter the live DOM. */
function xml(value: string): Document {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(value)) throw new Error('电子书包含不支持的 XML 实体声明。')
  const result = new DOMParser().parseFromString(value.replace(/<!DOCTYPE[^>]*>/gi, ''), 'application/xml')
  if (result.querySelector('parsererror')) throw new Error('EPUB 的目录或正文 XML 已损坏。')
  return result
}
function resolve(path: string, base = ''): { path: string; fragment: string } {
  if (/^[a-z][a-z0-9+.-]*:|^\/|\\/i.test(path)) throw new Error('电子书包含外部或非法资源路径。')
  const relative = path.split('#')[0]!.split('?')[0]
  const parts = (relative ? base.slice(0, base.lastIndexOf('/') + 1) + relative : base).split('/')
  const normalized: string[] = []
  for (const value of parts) {
    const part = decodeURIComponent(value)
    if (part === '..') { if (!normalized.length) throw new Error('电子书资源超出内部目录。'); normalized.pop() }
    else if (part && part !== '.') { if (part.includes('/') || part.includes('\\') || part.includes('\0')) throw new Error('电子书资源路径无效。'); normalized.push(part) }
  }
  return { path: normalized.join('/'), fragment: decodeURIComponent(path.split('#').slice(1).join('#')) }
}

export async function epubBook(bytes: Uint8Array, signal: AbortSignal, progress: (text: string) => void): Promise<ReadingBook> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false, useCompressionStream: true, checkCrc32: true, strictness: 'strict' })
  const files = new Map<string, FileEntry>(), blocks: ReadingBlock[] = [], anchors = new Map<string, ReadingLocator>()
  let declared = 0, expanded = 0, warning = ''
  const expandedPaths = new Set<string>()
  async function read(path: string): Promise<Uint8Array> {
    signal.throwIfAborted()
    const entry = files.get(path)
    if (!entry) throw new Error('EPUB 缺少内部文件：' + path)
    const pieces: Uint8Array[] = []; let size = 0
    await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
      size += chunk.length
      if (!expandedPaths.has(path)) expanded += chunk.length
      if (size > 16 * 1024 * 1024 || expanded > 128 * 1024 * 1024) throw new Error('EPUB 解压内容超出安全限制。')
      pieces.push(chunk)
    } }), { signal })
    const result = new Uint8Array(size); let offset = 0
    for (const piece of pieces) { result.set(piece, offset); offset += piece.length }
    expandedPaths.add(path)
    return result
  }
  async function readXml(path: string) { return xml(new TextDecoder('utf-8', { fatal: true }).decode(await read(path))) }
  const location = (part: string, block: number): ReadingLocator => ({ v: 1, part, block, offset: 0, encoding: 'auto' })
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.directory) continue
      if (files.size >= 5000 || entry.encrypted || entry.uncompressedSize > 16 * 1024 * 1024) throw new Error('EPUB 文件过多、单项过大或已加密，不支持阅读。')
      const path = resolve(entry.filename).path
      if (files.has(path)) throw new Error('EPUB 含有重复资源路径。')
      files.set(path, entry); declared += entry.uncompressedSize
      if (declared > 128 * 1024 * 1024) throw new Error('EPUB 解压总大小超出安全限制。')
    }
    if (new TextDecoder().decode(await read('mimetype')).trim() !== 'application/epub+zip') throw new Error('文件不是有效的 EPUB 电子书。')
    if (files.has('META-INF/encryption.xml')) throw new Error('本版不支持带 DRM、加密或混淆资源的 EPUB，请使用未加密版本。')
    const container = await readXml('META-INF/container.xml')
    const packagePath = resolve(container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path') || '').path
    const packageDocument = await readXml(packagePath)
    if ([...packageDocument.getElementsByTagNameNS('*', 'meta')].some(item => item.getAttribute('property') === 'rendition:layout' && item.textContent === 'pre-paginated')) throw new Error('本版书籍阅读暂不支持固定版式 EPUB，可下载原文件查看。')
    const manifest = new Map([...packageDocument.getElementsByTagNameNS('*', 'item')].map(item => [item.getAttribute('id'), item]))
    const spine = [...packageDocument.getElementsByTagNameNS('*', 'itemref')].filter(item => item.getAttribute('linear') !== 'no')
    if (!spine.length) throw new Error('EPUB 没有可阅读的正文。')
    const fallbacks: ReadingChapter[] = []
    for (let section = 0; section < spine.length; section++) {
      signal.throwIfAborted(); progress(`正在读取 EPUB 正文 ${section + 1} / ${spine.length}…`)
      const item = manifest.get(spine[section]!.getAttribute('idref'))
      if (!item || item.getAttribute('media-type') !== 'application/xhtml+xml') throw new Error('EPUB 含有本版不支持的正文格式。')
      const path = resolve(item.getAttribute('href') || '', packagePath).path
      const document = await readXml(path), start = blocks.length
      let index = 0
      const visit = (element: Element) => {
        const name = element.localName.toLowerCase()
        if (['script','style','link','iframe','object','embed','form','input','button','video','audio','svg','math','noscript','head'].includes(name)) return
        const loc = location(path, index)
        if (element.id) anchors.set(`${path}#${element.id}`, loc)
        if (name === 'img') {
          try {
            const image = resolve(element.getAttribute('src') || '', path).path
            if (!files.has(image) || !/\.(png|jpe?g|webp|gif)$/i.test(image)) throw new Error()
            blocks.push({ part: path, index: index++, text: element.getAttribute('alt') || '插图', heading: false, image })
          } catch { warning = '部分外部或不支持的插图已阻止加载。' }
        } else if (/^(p|h[1-6]|li|pre|blockquote|figcaption)$/.test(name)) {
          // Extract text without including scripts/styles hidden inside otherwise ordinary paragraphs.
          const safe = element.cloneNode(true) as Element
          safe.querySelectorAll('script,style,iframe,object,embed,form,svg,math').forEach(node => node.remove())
          const text = (safe.textContent || '').replace(/\s+/g, ' ').trim()
          for (let offset = 0; offset < text.length; offset += 1800) blocks.push({ part: path, index: index++, text: text.slice(offset, offset + 1800), heading: /^h[1-6]$/.test(name) && offset === 0 })
          for (const image of element.querySelectorAll('img')) visit(image)
          for (const anchor of element.querySelectorAll('[id]')) if (anchor.id) anchors.set(`${path}#${anchor.id}`, loc)
        } else {
          for (const node of element.childNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) visit(node as Element)
            else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) blocks.push({ part: path, index: index++, text: node.textContent.trim(), heading: false })
          }
        }
        if (blocks.length > 250000) throw new Error('EPUB 正文段落过多。')
      }
      const body = document.getElementsByTagNameNS('*', 'body')[0]
      if (body) visit(body)
      if (blocks.length === start) blocks.push({ part: path, index: 0, text: '（此正文段没有可显示内容）', heading: false })
      anchors.set(path, location(path, 0))
      fallbacks.push({ key: path, title: `正文 ${section + 1}（阅读顺序）`, location: location(path, 0) })
      // Yield between spine documents so cancellation and mobile controls remain responsive.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const target = (href: string, base: string) => {
      try { const dest = resolve(href, base); return anchors.get(dest.path + (dest.fragment ? '#' + dest.fragment : '')) || anchors.get(dest.path) }
      catch { return undefined }
    }
    let chapters: ReadingChapter[] = []
    const nav = [...manifest.values()].find(item => item.getAttribute('properties')?.split(/\s+/).includes('nav'))
    const ncx = manifest.get(packageDocument.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc') || '')
    if (nav) {
      const path = resolve(nav.getAttribute('href') || '', packagePath).path, document = await readXml(path)
      const toc = [...document.getElementsByTagNameNS('*', 'nav')].find(item => item.getAttributeNS('http://www.idpf.org/2007/ops', 'type')?.split(/\s+/).includes('toc'))
      const parse = (list: Element, prefix = ''): ReadingChapter[] => [...list.children].filter(child => child.localName === 'li').map((item, index) => {
        const link = [...item.children].find(child => ['a','span'].includes(child.localName)), sublist = [...item.children].find(child => child.localName === 'ol')
        return { key: `${prefix}/${index}`, title: link?.textContent?.trim() || '未命名目录', location: link?.getAttribute('href') ? target(link.getAttribute('href')!, path) : undefined, children: sublist ? parse(sublist, `${prefix}/${index}`) : undefined }
      })
      const list = toc && [...toc.children].find(item => item.localName === 'ol')
      if (list) chapters = parse(list)
    } else if (ncx) {
      const path = resolve(ncx.getAttribute('href') || '', packagePath).path, document = await readXml(path)
      const parse = (parent: Element, prefix = ''): ReadingChapter[] => [...parent.children].filter(item => item.localName === 'navPoint').map((item, index) => ({
        key: `${prefix}/${index}`, title: item.getElementsByTagNameNS('*', 'navLabel')[0]?.textContent?.trim() || '未命名目录',
        location: target(item.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src') || '', path), children: parse(item, `${prefix}/${index}`),
      }))
      const map = document.getElementsByTagNameNS('*', 'navMap')[0]
      if (map) chapters = parse(map)
    }
    if (!chapters.length) { chapters = fallbacks; warning = 'EPUB 没有可用目录，以下按正文文件阅读顺序导航。' }
    return { chunks: chunksFrom(blocks), chapters, warning, close() { void reader.close() }, async image(path) {
      const bytes = await read(path)
      const prefix = [...bytes.slice(0, 12)].map(value => value.toString(16).padStart(2, '0')).join('')
      const type = prefix.startsWith('89504e470d0a1a0a') ? 'image/png' : prefix.startsWith('ffd8ff') ? 'image/jpeg' : prefix.startsWith('47494638') ? 'image/gif' : prefix.startsWith('52494646') && prefix.endsWith('57454250') ? 'image/webp' : ''
      if (!type) throw new Error('插图内容格式不支持。')
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
    } }
  } catch (cause) {
    await reader.close()
    if (cause instanceof Error && /unsafe filename/i.test(cause.message)) throw new Error('EPUB 资源路径不安全，无法阅读。')
    if (cause instanceof Error && /^[\x00-\x7f]+$/.test(cause.message) && !signal.aborted) throw new Error('EPUB 归档损坏、校验失败或浏览器不支持解压，请下载原文件查看。')
    throw cause
  }
}
