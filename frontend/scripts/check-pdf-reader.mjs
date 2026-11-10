import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function checkPdfReader(page, output, fixtures) {
  const errors = [], dialogs = []
  const onError = error => errors.push(error.message)
  const onDialog = async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() }
  page.on('pageerror', onError); page.on('dialog', onDialog)
  const reader = page.getByRole('region', { name: 'PDF 只读预览' })
  await page.locator('[data-file-path="reader.pdf"]').click()
  await page.getByText('第 1 / 12 页', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.pdf-pages .textLayer')?.textContent.includes('PDF reader chapter 1'))
  const tree = page.getByRole('tree')
  await tree.getByText('第一章 开始', { exact: true }).waitFor()
  await tree.getByText('子章节 第二页', { exact: true }).click()
  await page.getByText('第 2 / 12 页', { exact: true }).waitFor()
  await tree.getByText('第二章 第三页', { exact: true }).click()
  await page.getByText('第 3 / 12 页', { exact: true }).waitFor()
  assert.equal(await tree.locator('img').count(), 0, 'Outline titles must remain text')
  await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).fill('1')
  await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).press('Enter')
  await page.getByText('第 1 / 12 页', { exact: true }).waitFor()
  const external = page.locator('.pdf-pages .annotationLayer a[href="https://example.com/reader-test"]')
  await external.waitFor()
  assert.equal(await external.getAttribute('target'), '_blank')
  assert.ok((await external.getAttribute('rel')).includes('noopener'))
  await page.locator('.pdf-pages').focus(); await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: 'PDF 搜索文字', exact: true }).fill('needle')
  await page.waitForFunction(() => document.querySelector('.pdf-find-status')?.textContent.includes('/ 12 项'))
  await page.locator('.pdf-pages .textLayer .highlight.selected').first().waitFor()
  await page.getByRole('button', { name: '下一个匹配', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.pdf-find-status')?.textContent.startsWith('2 /'))
  await page.getByRole('textbox', { name: 'PDF 搜索文字', exact: true }).fill('nonexistent-reader-text')
  await page.getByText('未找到匹配内容', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭查找', exact: true }).click()
  // Genuine browser Selection uses the upstream text layer, not OCR or copied test strings.
  const selected = await page.locator('.pdf-pages .textLayer').first().evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    const text = selection.toString(); selection.removeAllRanges(); return text
  })
  assert.ok(selected.includes('PDF reader chapter'))
  await page.getByRole('button', { name: '缩略图', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.pdf-thumbnail canvas')].some(canvas => canvas.width > 0))
  await page.getByRole('button', { name: '跳转到第 2 页', exact: true }).click()
  await page.getByText('第 2 / 12 页', { exact: true }).waitFor()
  await page.getByRole('button', { name: '目录与缩略图', exact: true }).click()
  // Closing the sidebar recalculates fit-width and therefore the document's scroll height.
  await page.waitForFunction(() => {
    const container = document.querySelector('.pdf-pages')
    container.scrollTop = container.scrollHeight
    return document.querySelector('.pdf-reader-status')?.textContent.includes('第 12 / 12 页')
  })
  assert.ok(await page.locator('.pdf-pages canvas').count() < 12, 'Offscreen pages must not all retain canvases')
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.getByText('第 11 / 12 页', { exact: true }).waitFor()
  await page.getByRole('button', { name: '顺时针旋转', exact: true }).click()
  await page.waitForFunction(() => { const element = document.querySelector('.pdf-pages .page[data-page-number="11"]'); return element && element.getBoundingClientRect().width > element.getBoundingClientRect().height })
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await page.locator('.pdf-reader-status').filter({ hasText: '%' }).waitFor()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'reader.pdf')
  assert.deepEqual(await readFile(await download.path()), await readFile(fixtures + 'reader.pdf'))
  // Reset to a newly opened reader for stable fit-width layout screenshots after rotation/zoom checks.
  await page.locator('[data-file-path="sample.pdf"]').click()
  await page.locator('[data-file-path="reader.pdf"]').click()
  await page.waitForFunction(() => document.querySelector('.pdf-pages .textLayer')?.textContent.includes('PDF reader chapter 1'))
  await page.getByRole('tree').getByText('第一章 开始', { exact: true }).waitFor()
  await page.screenshot({ path: output + '/pdf-reader-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 850 })
  await page.getByRole('button', { name: '目录与缩略图', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.pdf-pages .page')?.getBoundingClientRect().width < innerWidth)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: output + '/pdf-reader-narrow.png', fullPage: true })
  await page.getByRole('button', { name: '目录与缩略图', exact: true }).click()
  await page.getByRole('tree').getByText('第二章 第三页', { exact: true }).click()
  await page.locator('.pdf-sidebar').waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('[data-file-path="sample.pdf"]').click()
  if (await page.getByRole('button', { name: '目录与缩略图', exact: true }).getAttribute('aria-expanded') === 'false') await page.getByRole('button', { name: '目录与缩略图', exact: true }).click()
  await page.getByText('此文档没有目录。', { exact: false }).waitFor()
  // Real print rasterization/layout; OS print dialog/physical output remain manual checks.
  const printResult = await page.evaluate(async () => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('/node_modules/pdfjs-dist/build/pdf.worker.mjs', location.href).href
    const { preparePdfPrint } = await import('/src/modules/document/pdf-print.ts')
    const { listNotes } = await import('/src/shared/api/client.ts')
    const file = (await listNotes()).find(item => item.path === 'sample.pdf')
    const response = await fetch(`/api/v1/files/${file.id}/content?version=${file.version}`)
    const task = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) })
    const document = await task.promise
    const progress = [], abort = new AbortController()
    const job = await preparePdfPrint(document, 0, abort.signal, page => progress.push(page))
    const frame = window.document.querySelector('.pdf-print-frame')
    const images = [...frame.contentDocument.querySelectorAll('img')]
    const result = { progress, decoded: images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0) }
    job.dispose(); await task.destroy()
    return result
  })
  assert.deepEqual(printResult, { progress: [1, 2], decoded: true })
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, [])
  page.off('pageerror', onError); page.off('dialog', onDialog)
  console.log('Real PDF outline/named destinations, lazy pages/thumbnails, text selection, search, rotation, download and print rasterization passed')
}
