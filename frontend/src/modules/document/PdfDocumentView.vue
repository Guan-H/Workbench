<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, InputNumber as AInputNumber, Select as ASelect, Spin as ASpin, Tree as ATree } from 'ant-design-vue'
import { BookOpen, ChevronLeft, ChevronRight, Download, List, Minus, Plus, Printer, RotateCw, Search, X } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import { EventBus, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { apiResponse } from '../../shared/api/client'
import PdfThumbnail from './PdfThumbnail.vue'
import { preparePdfPrint } from './pdf-print'

const props = defineProps<{ id: string; version: string; name: string }>()
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
type OutlineItem = Awaited<ReturnType<pdfjs.PDFDocumentProxy['getOutline']>>[number]
interface OutlineNode { key: string; title: string; children?: OutlineNode[] }
const root = ref<HTMLElement>(), container = ref<HTMLDivElement>(), surface = ref<HTMLDivElement>()
const pdf = shallowRef<pdfjs.PDFDocumentProxy>()
const page = ref(1), pages = ref(0), busy = ref(true), ready = ref(false), error = ref('')
const pageInput = ref<number | string>(1)
const sidebar = ref(window.innerWidth >= 900), sidebarTab = ref('outline'), outline = ref<OutlineNode[]>([]), selectedKeys = ref<string[]>([])
const query = ref(''), findVisible = ref(false)
const matches = ref({ current: 0, total: 0 }), findState = ref(''), scale = ref('page-width'), percent = ref(100), rotation = ref(0)
const printing = ref(false), printPage = ref(0), printAllowed = ref(true)
const abort = new AbortController(), bus = new EventBus(), destinations = new Map<string, OutlineItem>()
let viewer: PDFViewer | undefined, links: PDFLinkService | undefined, finder: PDFFindController | undefined
let loading: pdfjs.PDFDocumentLoadingTask | undefined, disposed = false, objectUrl: string | undefined
let printAbort: AbortController | undefined, printJob: Awaited<ReturnType<typeof preparePdfPrint>> | undefined
let resize: ResizeObserver | undefined, resizeFrame = 0
watch(page, value => { pageInput.value = value })

function navigate(value: number | string | null | undefined) {
  const number = Number(value)
  if (viewer && ready.value && Number.isInteger(number) && number >= 1 && number <= pages.value) {
    viewer.currentPageNumber = number
    page.value = number
  }
}

function applyScale(value: string) {
  if (!viewer || !ready.value) return
  scale.value = value
  viewer.currentScaleValue = value
}

function zoom(direction: number) {
  if (!viewer) return
  applyScale(String(Math.max(0.25, Math.min(4, Math.round((viewer.currentScale + direction * 0.25) * 100) / 100))))
}

function rotate() {
  if (!viewer) return
  rotation.value = (rotation.value + 90) % 360
  viewer.pagesRotation = rotation.value
}

function outlineNodes(items: OutlineItem[], parent = ''): OutlineNode[] {
  return items.map((item, index) => {
    const key = `${parent}/${index}`
    destinations.set(key, item)
    return { key, title: item.title || '未命名书签', children: item.items?.length ? outlineNodes(item.items, key) : undefined }
  })
}

async function selectOutline(keys: (string | number)[]) {
  const key = String(keys[0] ?? ''), item = destinations.get(key)
  selectedKeys.value = key ? [key] : []
  if (!item || !links) return
  try {
    if (item.dest) await links.goToDestination(item.dest)
    else if (item.url) {
      const url = new URL(item.url)
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('此目录链接类型不支持，请下载原文件后查看。')
      window.open(url.href, '_blank', 'noopener,noreferrer')
    }
    if (window.innerWidth < 700) sidebar.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法跳转到该目录位置。' }
}

function search(again = false, previous = false) {
  if (!ready.value) return
  findState.value = query.value ? '正在查找…' : ''
  if (!query.value) matches.value = { current: 0, total: 0 }
  bus.dispatch('find', { source: root.value, type: again ? 'again' : '', query: query.value, phraseSearch: true,
    caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false })
}

async function showFind() {
  findVisible.value = true
  await nextTick(); root.value?.querySelector<HTMLInputElement>('.pdf-findbar input')?.focus()
}

function closeFind() {
  findVisible.value = false; query.value = ''; matches.value = { current: 0, total: 0 }; findState.value = ''
  bus.dispatch('findbarclose', { source: root.value })
  container.value?.focus()
}

function keyboard(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); void showFind() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); event.stopPropagation(); void print() }
  if (event.key === 'Escape' && findVisible.value) { event.preventDefault(); closeFind() }
}

function download() {
  if (!objectUrl) return
  const anchor = document.createElement('a')
  anchor.href = objectUrl; anchor.download = props.name.split('/').at(-1) || 'document.pdf'; anchor.click()
}

async function print() {
  if (!pdf.value || printing.value || !printAllowed.value) return
  printJob?.dispose(); printAbort?.abort()
  printAbort = new AbortController(); printing.value = true; error.value = ''
  try {
    printJob = await preparePdfPrint(pdf.value, rotation.value, printAbort.signal, value => { printPage.value = value })
    if (!disposed) printJob.print()
  } catch (cause) {
    if (!disposed && !printAbort.signal.aborted) error.value = cause instanceof Error ? cause.message : '打印准备失败，请下载原文件后打印。'
  } finally { if (!disposed) printing.value = false }
}

onMounted(async () => {
  try {
    if (!container.value || !surface.value) return
    links = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow', ignoreDestinationZoom: true })
    finder = new PDFFindController({ eventBus: bus, linkService: links })
    // No scripting manager, XFA, editable forms or annotation editor. Only the read-only layers are enabled.
    const options: ConstructorParameters<typeof PDFViewer>[0] & { abortSignal: AbortSignal } = {
      container: container.value, viewer: surface.value, eventBus: bus, linkService: links, findController: finder,
      annotationMode: pdfjs.AnnotationMode.ENABLE, annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
      maxCanvasPixels: 16000000, maxCanvasDim: 8192, imageResourcesPath: '/pdfjs/images/', enablePermissions: true,
      abortSignal: abort.signal,
    }
    viewer = new PDFViewer(options)
    links.setViewer(viewer)
    bus.on('pagesinit', () => { if (!disposed) { ready.value = true; viewer!.currentScaleValue = scale.value } })
    bus.on('pagerendered', (event: { error?: unknown }) => {
      if (disposed) return
      busy.value = false
      if (event.error) error.value = '部分页面渲染失败，可切换页面重试或下载原文件。'
    })
    bus.on('pagechanging', (event: { pageNumber: number }) => { if (!disposed) page.value = event.pageNumber })
    bus.on('scalechanging', (event: { scale: number }) => { if (!disposed) percent.value = Math.round(event.scale * 100) })
    bus.on('updatefindmatchescount', (event: { matchesCount: { current: number; total: number } }) => { if (!disposed) matches.value = event.matchesCount })
    bus.on('updatefindcontrolstate', (event: { state: number; matchesCount: { current: number; total: number } }) => {
      if (disposed) return
      matches.value = event.matchesCount
      findState.value = event.state === 1 ? '未找到匹配内容' : event.state === 3 ? '正在查找…' : event.state === 2 ? '已回到另一端继续查找' : ''
    })
    const response = await apiResponse(`/files/${props.id}/content?version=${props.version}`, { signal: abort.signal })
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (disposed) return
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    loading = pdfjs.getDocument({ data: bytes, enableXfa: false, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' })
    loading.onPassword = () => { error.value = '该 PDF 需要密码，本版请下载原文件后打开。'; busy.value = false; void loading?.destroy() }
    const document = await loading.promise
    if (disposed) { await loading.destroy(); return }
    pdf.value = document; pages.value = document.numPages
    viewer.setDocument(document); links.setDocument(document)
    // Optional metadata must not prevent the document itself from being read.
    void document.getOutline().then(value => { if (!disposed) outline.value = outlineNodes(value || []) }).catch(() => { if (!disposed) error.value = '目录读取失败，仍可使用页码或缩略图浏览。' })
    void document.getPermissions().then(value => {
      if (!disposed) printAllowed.value = !value || value.has(pdfjs.PermissionFlag.PRINT) || value.has(pdfjs.PermissionFlag.PRINT_HIGH_QUALITY)
    }).catch(() => undefined)
    resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        if (!disposed && ready.value && ['page-width', 'page-fit'].includes(scale.value)) viewer!.currentScaleValue = scale.value
      })
    })
    resize.observe(container.value)
  } catch (cause) {
    if (!disposed) { error.value ||= cause instanceof Error ? cause.message : 'PDF 加载失败。'; busy.value = false }
  }
})

onBeforeUnmount(() => {
  disposed = true; abort.abort(); printAbort?.abort(); printJob?.dispose(); resize?.disconnect(); cancelAnimationFrame(resizeFrame)
  viewer?.setDocument(null); links?.setDocument(null); void viewer?.l10n?.destroy(); void loading?.destroy()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <section ref="root" class="pdf-document-view" aria-label="PDF 只读预览" @keydown="keyboard">
    <link rel="stylesheet" :href="`/pdfjs/viewer.css?v=${pdfjs.version}`">
    <div class="pdf-toolbar" role="toolbar" aria-label="PDF 阅读工具">
      <div class="pdf-tool-group">
        <AButton title="目录与缩略图" aria-label="目录与缩略图" :aria-expanded="sidebar" :type="sidebar ? 'primary' : 'default'" @click="sidebar = !sidebar"><List :size="17" /></AButton>
        <AButton title="上一页" aria-label="上一页" :disabled="!ready || page <= 1" @click="navigate(page - 1)"><ChevronLeft :size="17" /></AButton>
        <label class="pdf-page-label">页码 <AInputNumber v-model:value="pageInput" aria-label="PDF 页码" :min="1" :max="pages || 1" :disabled="!ready" :controls="false" @press-enter="navigate(pageInput)" @blur="navigate(pageInput)" /></label>
        <span class="pdf-page-count">/ {{ pages }}</span>
        <AButton title="下一页" aria-label="下一页" :disabled="!ready || page >= pages" @click="navigate(page + 1)"><ChevronRight :size="17" /></AButton>
      </div>
      <div class="pdf-tool-group">
        <AButton title="缩小" aria-label="缩小" :disabled="!ready || percent <= 25" @click="zoom(-1)"><Minus :size="16" /></AButton>
        <ASelect aria-label="PDF 缩放" :value="scale" :disabled="!ready" :options="[{ value: 'page-width', label: '适合宽度' }, { value: 'page-fit', label: '适合整页' }, ...[0.5,0.75,1,1.25,1.5,2,3,4].map(value => ({ value: String(value), label: `${value * 100}%` })), ...(!['page-width','page-fit','0.5','0.75','1','1.25','1.5','2','3','4'].includes(scale) ? [{ value: scale, label: `${percent}%` }] : [])]" @change="value => applyScale(String(value))" />
        <AButton title="放大" aria-label="放大" :disabled="!ready || percent >= 400" @click="zoom(1)"><Plus :size="16" /></AButton>
      </div>
      <div class="pdf-tool-group pdf-tool-actions">
        <AButton title="查找文字（Ctrl+F）" aria-label="查找文字" :disabled="!ready" @click="showFind"><Search :size="16" /></AButton>
        <AButton title="顺时针旋转" aria-label="顺时针旋转" :disabled="!ready" @click="rotate"><RotateCw :size="16" /></AButton>
        <AButton title="下载 PDF" aria-label="下载 PDF" :disabled="!pdf" @click="download"><Download :size="16" /></AButton>
        <AButton :title="printAllowed ? '打印 PDF（Ctrl+P）' : '文档限制打印'" aria-label="打印 PDF" :disabled="!ready || !printAllowed" :loading="printing" @click="print"><Printer v-if="!printing" :size="16" /></AButton>
      </div>
    </div>
    <div v-if="findVisible" class="pdf-findbar" role="search" aria-label="查找 PDF 文字">
      <AInput v-model:value="query" aria-label="PDF 搜索文字" placeholder="查找文档中的文字" allow-clear @input="search()" @press-enter="event => search(true, event.shiftKey)" />
      <span class="pdf-find-status" role="status">{{ query ? matches.total ? `${matches.current} / ${matches.total} 项` : findState : '输入关键词' }}</span>
      <AButton title="上一个匹配" aria-label="上一个匹配" :disabled="!query" @click="search(true, true)"><ChevronLeft :size="16" /></AButton>
      <AButton title="下一个匹配" aria-label="下一个匹配" :disabled="!query" @click="search(true)"><ChevronRight :size="16" /></AButton>
      <AButton title="关闭查找" aria-label="关闭查找" @click="closeFind"><X :size="16" /></AButton>
    </div>
    <AAlert v-if="error" type="error" show-icon :message="error" />
    <div v-if="printing" class="pdf-print-progress" role="status">正在准备打印 {{ printPage }} / {{ pages }} 页… <AButton size="small" @click="printAbort?.abort()">取消准备</AButton></div>
    <div class="pdf-reader-body">
      <aside v-if="sidebar" class="pdf-sidebar" aria-label="PDF 导航侧栏">
        <div class="pdf-sidebar-tabs" role="group" aria-label="PDF 导航方式">
          <AButton :type="sidebarTab === 'outline' ? 'primary' : 'default'" @click="sidebarTab = 'outline'"><BookOpen :size="15" />目录</AButton>
          <AButton :type="sidebarTab === 'thumbnails' ? 'primary' : 'default'" @click="sidebarTab = 'thumbnails'">缩略图</AButton>
        </div>
        <div class="pdf-sidebar-scroll">
          <template v-if="sidebarTab === 'outline'">
            <ASpin v-if="!pdf && busy" />
            <ATree v-else-if="outline.length" :tree-data="outline" :selected-keys="selectedKeys" block-node default-expand-all @select="(_keys, info) => selectOutline([info.node.key])" />
            <p v-else class="pdf-empty-outline">此文档没有目录。<br>可切换缩略图浏览页面。</p>
          </template>
          <template v-else-if="pdf">
            <PdfThumbnail v-for="number in pages" :key="number" :document="pdf" :number="number" :rotation="rotation" :active="page === number" @navigate="navigate" />
          </template>
        </div>
      </aside>
      <div class="pdf-main">
        <div ref="container" class="pdf-pages" tabindex="0" aria-label="PDF 连续阅读区" :aria-busy="busy">
          <div ref="surface" class="pdfViewer" />
        </div>
        <div v-if="busy" class="pdf-loading" role="status"><ASpin /><span>正在加载 PDF…</span></div>
      </div>
    </div>
    <footer class="pdf-reader-status"><span>第 {{ page }} / {{ pages }} 页</span><span>{{ percent }}% · 只读预览</span></footer>
  </section>
</template>

<style scoped>
.pdf-document-view { min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.pdf-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; padding: 10px 12px; border-bottom: 1px solid var(--color-border); }
.pdf-tool-group { display: flex; align-items: center; gap: 6px; }
.pdf-tool-actions { margin-left: auto; }
.pdf-toolbar :deep(.ant-btn), .pdf-findbar :deep(.ant-btn) { display: inline-flex; align-items: center; justify-content: center; padding-inline: 9px; min-width: 34px; }
.pdf-page-label { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.pdf-page-label :deep(.ant-input-number) { width: 56px; }
.pdf-page-count { min-width: 24px; white-space: nowrap; }
.pdf-toolbar :deep(.ant-select) { width: 112px; }
.pdf-findbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--color-border); }
.pdf-findbar :deep(.ant-input-affix-wrapper) { flex: 1; min-width: 130px; max-width: 340px; }
.pdf-find-status { font-size: 12px; min-width: 65px; }
.pdf-reader-body { display: flex; flex: 1; min-height: 0; position: relative; }
.pdf-sidebar { width: 230px; max-width: 70%; display: flex; flex-direction: column; flex-shrink: 0; border-right: 1px solid var(--color-border); background: var(--color-surface, white); z-index: 2; }
.pdf-sidebar-tabs { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--color-border); }
.pdf-sidebar-tabs :deep(.ant-btn) { display: inline-flex; align-items: center; gap: 6px; }
.pdf-sidebar-scroll { overflow: auto; flex: 1; min-height: 0; padding: 8px; }
.pdf-sidebar-scroll :deep(.ant-tree-title) { overflow-wrap: anywhere; white-space: normal; }
.pdf-sidebar-scroll :deep(.ant-tree-node-content-wrapper) { min-width: 0; }
.pdf-empty-outline { padding: 24px 10px; line-height: 1.8; color: var(--color-text-muted); font-size: 13px; }
.pdf-main { position: relative; min-width: 0; flex: 1; background: var(--color-background); }
.pdf-pages { position: absolute; inset: 0; overflow: auto; overscroll-behavior: contain; }
.pdf-pages:focus-visible { outline: 2px solid var(--color-primary, #377b60); outline-offset: -2px; }
.pdf-loading { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; gap: 12px; background: var(--color-background); pointer-events: none; }
.pdf-reader-status { display: flex; justify-content: space-between; gap: 12px; padding: 5px 12px; font-size: 12px; border-top: 1px solid var(--color-border); }
.pdf-print-progress { padding: 8px 12px; display: flex; align-items: center; gap: 12px; }
@media (max-width: 700px) {
  .pdf-toolbar { gap: 8px; padding: 8px; }
  .pdf-tool-actions { margin-left: 0; }
  .pdf-sidebar { position: absolute; inset: 0 auto 0 0; width: 230px; box-shadow: 4px 0 16px #0002; }
  .pdf-toolbar :deep(.ant-btn) { min-height: 38px; min-width: 38px; }
}
</style>
