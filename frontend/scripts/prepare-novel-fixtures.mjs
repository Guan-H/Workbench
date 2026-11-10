import { mkdir, writeFile } from 'node:fs/promises'
import { ZipWriter, Uint8ArrayWriter, TextReader, Uint8ArrayReader } from '@zip.js/zip.js/index-native.js'
const directory = new URL('../../data/novel-fixtures/', import.meta.url)
await mkdir(directory, { recursive: true })
const lines = ['序章', '他想起第一章的内容，但这行是普通正文。', '第一卷 初入江湖']
for (let chapter = 1; chapter <= 24; chapter++) {
  lines.push(`第${chapter}章 测试旅程`)
  for (let paragraph = 1; paragraph <= 40; paragraph++) lines.push(`章节${chapter}段落${paragraph}：` + '虚构的阅读测试内容，只用于检验排版与位置恢复。'.repeat(17))
}
await writeFile(new URL('long-novel.txt', directory), '\ufeff' + lines.join('\r\n'))
await writeFile(new URL('changed.txt', directory), '第一章 开始\n用于内容变更保护的虚构正文。')
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
for (const format of ['epub3','epub2','no-nav','bad-path','bad-entity','encrypted']) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, useCompressionStream: true })
  const add = (name, content) => writer.add(name, typeof content === 'string' ? new TextReader(content) : new Uint8ArrayReader(content), { level: name === 'mimetype' ? 0 : 6 })
  await add('mimetype', 'application/epub+zip')
  await add('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  const metadata = '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>虚构电子书</dc:title><dc:identifier id="id">test-reader</dc:identifier><dc:language>zh</dc:language></metadata>'
  const items = '<item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="image" href="pixel.png" media-type="image/png"/>'
  await add('OPS/book.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="${format === 'epub2' ? '2.0' : '3.0'}" unique-identifier="id">${metadata}<manifest>${items}${format === 'epub2' ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : format !== 'no-nav' ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}</manifest><spine ${format === 'epub2' ? 'toc="ncx"' : ''}><itemref idref="one"/><itemref idref="two"/></spine></package>`)
  await add('OPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml#start">第一部 起程</a><ol><li><a href="one.xhtml#middle">子章节 途中</a></li></ol></li><li><a href="two.xhtml#start">第二部 归来</a></li></ol></nav></body></html>')
  await add('OPS/toc.ncx', '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="one"><navLabel><text>旧版第一章</text></navLabel><content src="one.xhtml#start"/></navPoint><navPoint id="two"><navLabel><text>旧版第二章</text></navLabel><content src="two.xhtml#start"/></navPoint></navMap></ncx>')
  const paragraphs = Array.from({ length: 80 }, (_, index) => `<p id="${index === 45 ? 'middle' : 'p' + index}">EPUB 段落 ${index + 1} ${'这是虚构的电子书内容。'.repeat(8)}</p>`).join('')
  await add('OPS/one.xhtml', `${format === 'bad-entity' ? '<!DOCTYPE html [<!ENTITY attack SYSTEM "https://blocked.reader.test/entity">]>' : '<!DOCTYPE html>'}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一部</title><style>body{background:url(https://blocked.reader.test/style)}</style><script>alert("READER_SCRIPT")</script></head><body><h1 id="start">第一部 起程</h1>${paragraphs}<img src="pixel.png" alt="库内插图"/><img src="https://blocked.reader.test/image"/><p onclick="alert(1)">安全正文<script>alert("NESTED_READER_SCRIPT")</script></p></body></html>`)
  await add('OPS/two.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二部</title></head><body><h1 id="start">第二部 归来</h1><p>故事结束，欢迎下次继续阅读。</p></body></html>')
  await add('OPS/pixel.png', png)
  if (format === 'bad-path') await add('../escape.xhtml', 'not allowed')
  if (format === 'encrypted') await add('META-INF/encryption.xml', '<encryption/>')
  await writeFile(new URL(format + '.epub', directory), await writer.close())
}
console.log('Prepared genuine TXT and EPUB fixtures with fictitious content')
