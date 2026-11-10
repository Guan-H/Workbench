import { AnnotationMode, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'

/** Render trusted PDF pixels into a disposable print frame; never interpolate PDF text into HTML. */
export async function preparePdfPrint(pdf: PDFDocumentProxy, rotation: number, signal: AbortSignal, progress: (page: number) => void) {
  const frame = document.createElement('iframe')
  frame.title = 'PDF 打印预览'
  frame.className = 'pdf-print-frame'
  Object.assign(frame.style, { position: 'fixed', width: '1px', height: '1px', right: '0', bottom: '0', border: '0' })
  const urls: string[] = []
  let task: RenderTask | undefined
  const dispose = () => { task?.cancel(); frame.remove(); urls.splice(0).forEach(url => URL.revokeObjectURL(url)) }
  signal.addEventListener('abort', dispose, { once: true })
  document.body.append(frame)
  try {
    const target = frame.contentDocument
    if (!target) throw new Error('浏览器无法创建打印页面，请下载原文件后打印。')
    const style = target.createElement('style')
    style.textContent = 'html,body{margin:0}img{display:block;width:100%;height:100%;object-fit:contain}.sheet{break-after:page;break-inside:avoid}.sheet:last-child{break-after:auto}'
    target.head.append(style)
    let pixels = 0
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted()
      progress(number)
      const page = await pdf.getPage(number)
      signal.throwIfAborted()
      const viewport = page.getViewport({ scale: 1.5, rotation: (page.rotate + rotation) % 360 })
      pixels += Math.ceil(viewport.width) * Math.ceil(viewport.height)
      if (pixels > 64000000) throw new Error('此文档打印准备所需内存较大，请下载原文件后使用桌面阅读器打印。')
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      task = page.render({ canvas, viewport, intent: 'print', annotationMode: AnnotationMode.ENABLE })
      await task.promise
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('打印页面生成失败。'))))
      canvas.width = 0; canvas.height = 0
      signal.throwIfAborted()
      const url = URL.createObjectURL(blob); urls.push(url)
      const sheet = target.createElement('div'), image = target.createElement('img')
      sheet.className = 'sheet'
      sheet.style.width = viewport.width / 1.5 + 'pt'; sheet.style.height = viewport.height / 1.5 + 'pt'
      // Named pages retain mixed portrait/landscape sizes rather than applying page one's size to every sheet.
      const pageName = `pdf-sheet-${number}`
      sheet.style.page = pageName
      style.textContent += `@page ${pageName}{size:${viewport.width / 1.5}pt ${viewport.height / 1.5}pt;margin:0}`
      image.src = url; image.alt = `第 ${number} 页`
      sheet.append(image); target.body.append(sheet)
      await image.decode()
    }
    signal.throwIfAborted()
    return {
      print() {
        frame.contentWindow?.addEventListener('afterprint', dispose, { once: true })
        frame.contentWindow?.focus(); frame.contentWindow?.print()
      },
      dispose,
    }
  } catch (cause) { dispose(); throw cause }
}
