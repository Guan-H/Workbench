// A genuine, deterministic 12-page PDF with nested bookmarks, named destinations and inert hostile actions.
// Content is fictitious; no user files or mocked API responses are used.
import { mkdir, writeFile } from 'node:fs/promises'
const directory = new URL('../../data/document-fixtures/', import.meta.url)
await mkdir(directory, { recursive: true })
const objects = []
const reserve = () => { objects.push(''); return objects.length }
const set = (id, value) => { objects[id - 1] = value }
const add = value => { const id = reserve(); set(id, value); return id }
const reference = id => `${id} 0 R`
const catalog = reserve(), pages = reserve(), outlines = reserve(), first = reserve(), nested = reserve(), second = reserve(), hostile = reserve()
const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
const pageIds = Array.from({ length: 12 }, reserve)
const utf16 = value => '<FEFF' + [...value].map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>'
for (let index = 0; index < pageIds.length; index++) {
  const text = `BT /F1 18 Tf 45 680 Td (PDF reader chapter ${index + 1} needle) Tj ET`
  const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`)
  const annotation = index === 0 ? add('<< /Type /Annot /Subtype /Link /Rect [40 620 180 650] /A << /S /URI /URI (https://example.com/reader-test) >> >>') : undefined
  set(pageIds[index], `<< /Type /Page /Parent ${reference(pages)} /MediaBox [0 0 540 720] /Resources << /Font << /F1 ${reference(font)} >> >> /Contents ${reference(content)} ${annotation ? `/Annots [${reference(annotation)}]` : ''} >>`)
}
set(pages, `<< /Type /Pages /Kids [${pageIds.map(reference).join(' ')}] /Count 12 >>`)
set(outlines, `<< /Type /Outlines /First ${reference(first)} /Last ${reference(hostile)} /Count 4 >>`)
set(first, `<< /Title ${utf16('第一章 开始')} /Parent ${reference(outlines)} /Next ${reference(second)} /Dest [${reference(pageIds[0])} /Fit] /First ${reference(nested)} /Last ${reference(nested)} /Count 1 >>`)
set(nested, `<< /Title ${utf16('子章节 第二页')} /Parent ${reference(first)} /Dest [${reference(pageIds[1])} /XYZ 0 720 null] >>`)
set(second, `<< /Title ${utf16('第二章 第三页')} /Parent ${reference(outlines)} /Prev ${reference(first)} /Next ${reference(hostile)} /Dest (chapter3) >>`)
set(hostile, `<< /Title (<img src=x onerror=alert\\(1\\)>) /Parent ${reference(outlines)} /Prev ${reference(second)} /Dest [${reference(pageIds[11])} /Fit] >>`)
set(catalog, `<< /Type /Catalog /Pages ${reference(pages)} /Outlines ${reference(outlines)} /Names << /Dests << /Names [(chapter3) [${reference(pageIds[2])} /XYZ 0 720 null]] >> >> /OpenAction << /S /JavaScript /JS (app.alert\\(PDF_SCRIPT_MUST_NOT_RUN\\)) >> >>`)
let result = '%PDF-1.7\n', offsets = [0]
objects.forEach((value, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${value}\nendobj\n` })
const xref = Buffer.byteLength(result)
result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
result += `trailer\n<< /Size ${objects.length + 1} /Root ${reference(catalog)} >>\nstartxref\n${xref}\n%%EOF\n`
await writeFile(new URL('reader.pdf', directory), result)
console.log('Prepared genuine PDF reader fixture')
