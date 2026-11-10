import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
const packageRoot = new URL('../node_modules/pdfjs-dist/', import.meta.url)
const target = new URL('../public/pdfjs/', import.meta.url)
await mkdir(target, { recursive: true })
for (const name of ['cmaps', 'standard_fonts', 'wasm']) await cp(new URL(name, packageRoot), new URL(name, target), { recursive: true })
await cp(new URL('web/images/', packageRoot), new URL('images/', target), { recursive: true })
// Keep upstream text/annotation styles inside the reader, including its custom properties.
const viewerCss = await readFile(new URL('web/pdf_viewer.css', packageRoot), 'utf8')
await writeFile(new URL('viewer.css', target), `@scope (.pdf-document-view) {\n${viewerCss.replaceAll(':root', ':scope')}\n}\n`)
const info = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
console.log('Prepared local PDF.js assets ' + info.version)
