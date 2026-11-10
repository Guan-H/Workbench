<script setup lang="ts">
import { Alert as AAlert, Button as AButton, ConfigProvider as AConfigProvider, Input as AInput, Select as ASelect, Slider as ASlider, Spin as ASpin, Tree as ATree, theme as antTheme } from 'ant-design-vue'
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Expand, List, Settings, Shrink, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { apiResponse, type Note } from '../../shared/api/client'
import type { ReadingBlock, ReadingBook, ReadingChapter, ReadingLocator } from './book'
import { epubBook } from './epub'
import { ReadingProgress } from './reading-progress'
import ReaderImage from './ReaderImage.vue'

const props = defineProps<{ file: Note; username: string }>()
const emit = defineEmits<{ updated: [precise: boolean] }>()
const root = ref<HTMLElement>(), scroller = ref<HTMLDivElement>()
const book = shallowRef<ReadingBook>(), busy = ref(true), loadingText = ref('正在读取书籍…'), error = ref(''), warning = ref('')
const progressText = ref(''), progressConflict = ref(false), savedLocation = shallowRef<ReadingLocator>()
const progressNeedsAttention = computed(() => !!progressText.value && !['阅读进度已保存', '阅读位置自动保存'].includes(progressText.value))
const encoding = ref('auto'), immersive = ref(false), fullscreen = ref(false), panel = ref<'contents' | 'settings'>(), chapterQuery = ref('')
const compactQuery = window.matchMedia('(max-width: 600px)')
const compact = ref(compactQuery.matches), controlsVisible = ref(false)
const minimal = computed(() => immersive.value && compact.value)
const readerColors = computed(() => theme.value === 'night'
  ? { background: '#202522', text: '#d9dfd9', border: '#48534b', primary: '#a0c9ac' }
  : theme.value === 'light'
    ? { background: '#ffffff', text: '#252a28', border: '#dce3dd', primary: '#39765b' }
    : { background: '#f4efdf', text: '#353329', border: '#d6cfbc', primary: '#526a43' })
const readerAntTheme = computed(() => ({
  algorithm: theme.value === 'night' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
  token: { colorBgContainer: readerColors.value.background, colorBgElevated: readerColors.value.background,
    colorText: readerColors.value.text, colorTextHeading: readerColors.value.text,
    colorBorder: readerColors.value.border, colorPrimary: readerColors.value.primary },
}))
let tapStart: { x: number; y: number; scrollTop: number } | undefined, tapReady = false
function compactChanged() { compact.value = compactQuery.matches }
function popupContainer() { return root.value || document.body }
watch(minimal, () => { controlsVisible.value = false })
function startTap(event: PointerEvent) {
  tapReady = false
  tapStart = event.isPrimary ? { x: event.clientX, y: event.clientY, scrollTop: scroller.value?.scrollTop || 0 } : undefined
}
function endTap(event: PointerEvent) {
  tapReady = !!tapStart && Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) <= 8
    && Math.abs((scroller.value?.scrollTop || 0) - tapStart.scrollTop) <= 8
  tapStart = undefined
}
function toggleReadingControls(event: MouseEvent) {
  if (!minimal.value || panel.value || busy.value || (event.detail > 0 && !tapReady) || !window.getSelection()?.isCollapsed) return
  controlsVisible.value = !controlsVisible.value
}
function readerKeys(event: KeyboardEvent) {
  if (panel.value || !minimal.value) return
  if (event.key === 'Escape' && controlsVisible.value) { event.preventDefault(); controlsVisible.value = false }
  if (event.key === 'Enter' && event.target === scroller.value) { event.preventDefault(); controlsVisible.value = !controlsVisible.value }
}
const fontSize = ref(20), lineHeight = ref(1.9), theme = ref('paper'), font = ref('sans'), selected = ref<string[]>([])
const heights = shallowRef<number[]>([]), first = ref(0), last = ref(3), location = shallowRef<ReadingLocator>()
const abort = new AbortController()
const tracker = new ReadingProgress(props.file, props.username, message => { if (!disposed) { progressText.value = message; progressConflict.value = tracker.conflict } })
const isText = computed(() => !props.file.path.toLowerCase().endsWith('.epub'))
const isMarkdown = computed(() => props.file.path.toLowerCase().endsWith('.md'))
let searchRestore: ReadingLocator | undefined
const settingsKey = `private-space:reader-settings:${props.username}`
let disposed = false, restoring = true, worker: Worker | undefined, scrollFrame = 0, resizeFrame = 0
let resize: ResizeObserver | undefined, chunkResize: ResizeObserver | undefined, epoch = 0
let layoutEpoch = 0, lastWidth = 0
const positions = new Map<string, { chunk: number; block: number }>()
let priorFocus: HTMLElement | null = null
const chunks = computed(() => book.value?.chunks || [])
const visible = computed(() => chunks.value.slice(first.value, last.value + 1).map((chunk, offset) => ({ ...chunk, index: first.value + offset })))
const before = computed(() => heights.value.slice(0, first.value).reduce((sum, height) => sum + height, 0))
const after = computed(() => heights.value.slice(last.value + 1).reduce((sum, height) => sum + height, 0))
const flatChapters = computed(() => {
  const result: ReadingChapter[] = []
  const visit = (nodes: ReadingChapter[]) => nodes.forEach(node => { if (node.location) result.push(node); if (node.children) visit(node.children) })
  visit(book.value?.chapters || []); return result
})
const currentChapter = computed(() => {
  const current = location.value
  if (!current) return -1
  const currentPosition = locate(current)
  if (!currentPosition) return -1
  let found = -1
  flatChapters.value.forEach((chapter, index) => {
    const target = chapter.location!, position = locate(target)
    if (position && (position.chunk < currentPosition.chunk || position.chunk === currentPosition.chunk && position.block <= currentPosition.block)) found = index
  })
  return found
})
const chapterTree = computed(() => {
  const query = chapterQuery.value.trim().toLowerCase()
  const filter = (nodes: ReadingChapter[]): ReadingChapter[] => nodes.flatMap(node => {
    const children = node.children ? filter(node.children) : []
    return !query || node.title.toLowerCase().includes(query) || children.length ? [{ ...node, children: children.length ? children : undefined }] : []
  })
  return filter(book.value?.chapters || [])
})
const percentage = computed(() => {
  const current = location.value && locate(location.value)
  if (!current) return 0
  const total = chunks.value.reduce((sum, item) => sum + item.characters, 0)
  const prefix = chunks.value.slice(0, current.chunk).reduce((sum, item) => sum + item.characters, 0)
  const inside = (chunks.value[current.chunk]?.blocks || []).slice(0, current.block).reduce((sum, item) => sum + item.text.length, 0)
  return total ? Math.min(100, Math.round((prefix + inside + (location.value?.offset || 0)) / total * 1000) / 10) : 0
})
const title = computed(() => props.file.path.split('/').at(-1))

function locate(target: ReadingLocator) {
  return positions.get(`${target.part}:${target.block}`)
}
function key(block: ReadingBlock) { return `${block.part}:${block.index}` }
function enrich(target: ReadingLocator): ReadingLocator {
  const found=locate(target), block=found && chunks.value[found.chunk]?.blocks[found.block]
  if (!block || block.image) return target
  const start=Math.max(0,target.offset-24)
  return {...target,quote:block.text.slice(start,target.offset+64),quoteOffset:target.offset-start,chapter:flatChapters.value[currentChapter.value]?.title?.slice(0,120)}
}
function matchUpdated(target: ReadingLocator): {location:ReadingLocator;precise:boolean} {
  if (target.quote && target.quote.length<=100 && Number.isInteger(target.quoteOffset)) {
    const matches:ReadingLocator[]=[]
    for (const chunk of chunks.value) for (const block of chunk.blocks) {
      const index=block.text.indexOf(target.quote)
      if(index>=0 && block.text.indexOf(target.quote,index+1)<0) matches.push({v:1,part:block.part,block:block.index,offset:index+(target.quoteOffset||0),encoding:encoding.value})
    }
    if(matches.length===1) return {location:matches[0]!,precise:true}
  }
  const chapter=flatChapters.value.filter(item=>item.title===target.chapter)
  if(chapter.length===1 && chapter[0]!.location) return {location:chapter[0]!.location!,precise:false}
  const first=chunks.value[0]!.blocks[0]!
  return {location:{v:1,part:first.part,block:first.index,offset:0,encoding:encoding.value},precise:false}
}
function defaultHeights() {
  const width = Math.max(180, Math.min(760, (scroller.value?.clientWidth || 375) - 48))
  return chunks.value.map(chunk => Math.max(80, chunk.blocks.reduce((sum, block) => sum + (block.image ? 260 : Math.ceil(Math.max(1, block.text.length) * fontSize.value / width) * fontSize.value * lineHeight.value + fontSize.value * .75), 0)))
}
async function measure() {
  if (!scroller.value || disposed) return
  const boundary = first.value
  const old = heights.value.slice(0, boundary).reduce((sum, height) => sum + height, 0), next = [...heights.value]
  scroller.value.querySelectorAll<HTMLElement>('.reader-chunk').forEach(element => { next[Number(element.dataset.chunk)] = element.getBoundingClientRect().height })
  const delta = next.slice(0, boundary).reduce((sum, height) => sum + height, 0) - old
  heights.value = next
  if (delta && !restoring) { await nextTick(); if (scroller.value) scroller.value.scrollTop += delta }
}
async function observeChunks() {
  await nextTick()
  chunkResize?.disconnect()
  scroller.value?.querySelectorAll('.reader-chunk').forEach(element => chunkResize?.observe(element))
  await measure()
}
function capture(): ReadingLocator | undefined {
  if (!scroller.value) return
  const rect = scroller.value.getBoundingClientRect()
  const element = [...scroller.value.querySelectorAll<HTMLElement>('[data-reader-block]')].find(item => item.getBoundingClientRect().bottom > rect.top + 12)
  if (!element) return
  let offset = 0
  const text = element.firstChild
  if (text?.nodeType === Node.TEXT_NODE && text.textContent?.length) {
    // Resolve the first visible character by line geometry. This is independent of browser caret-point APIs,
    // paragraph indentation and the x-coordinate, and stays meaningful after font/viewport changes.
    let low = 0, high = text.textContent.length
    const range = document.createRange(), top = rect.top + 16
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      range.setStart(text, middle); range.setEnd(text, Math.min(middle + 1, text.textContent.length))
      if (range.getBoundingClientRect().bottom <= top) low = middle + 1
      else high = middle
    }
    offset = low
  }
  return enrich({ v: 1, part: element.dataset.part!, block: Number(element.dataset.block), offset, encoding: encoding.value })
}
function updateWindow() {
  if (!scroller.value || restoring || disposed) return
  const top = scroller.value.scrollTop, bottom = top + scroller.value.clientHeight
  let sum = 0, start = 0, end = 0
  for (let index = 0; index < heights.value.length; index++) {
    const height = heights.value[index]!
    if (sum <= top) start = index
    if (sum <= bottom) end = index
    sum += height
  }
  const next = Math.max(0, start - 1), tail = Math.min(chunks.value.length - 1, end + 1)
  if (first.value !== next || last.value !== tail) { first.value = next; last.value = tail; void observeChunks().then(() => { if (!restoring && !disposed) recordVisible() }); return }
  recordVisible()
}
function recordVisible() {
  const current = capture()
  if (current) {
    location.value = current; tracker.record(current)
    const chapter = flatChapters.value[currentChapter.value]
    selected.value = chapter ? [chapter.key] : []
  }
}
function scroll() { cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(updateWindow) }

async function jump(target: ReadingLocator, save = true) {
  const found = locate(target)
  if (!found || !scroller.value) { warning.value = '原阅读位置无法准确定位，可从头阅读或选择章节。'; return }
  const serial = ++layoutEpoch
  restoring = true
  first.value = Math.max(0, found.chunk - 1); last.value = Math.min(chunks.value.length - 1, found.chunk + 1)
  await observeChunks()
  await nextTick()
  if (disposed || serial !== layoutEpoch || !scroller.value) return
  const element = [...scroller.value.querySelectorAll<HTMLElement>('[data-reader-block]')].find(item => item.dataset.part === target.part && Number(item.dataset.block) === target.block)
  if (element) {
    const text = element.firstChild
    let top = element.getBoundingClientRect().top
    if (text?.nodeType === Node.TEXT_NODE && target.offset <= (text.textContent?.length || 0)) {
      const range = document.createRange(); range.setStart(text, target.offset); range.collapse(true)
      const rect = range.getBoundingClientRect(); if (rect.height) top = rect.top
    }
    scroller.value.scrollTop += top - scroller.value.getBoundingClientRect().top - 16
  }
  location.value = enrich(target)
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (disposed || serial !== layoutEpoch) return
  restoring = false
  if (save) tracker.record(location.value)
}
async function reflow() {
  const target = location.value || capture()
  restoring = true; heights.value = defaultHeights()
  if (target) await jump(target, false)
  else { await observeChunks(); restoring = false }
}
function setting() {
  try { localStorage.setItem(settingsKey, JSON.stringify({ fontSize: fontSize.value, lineHeight: lineHeight.value, theme: theme.value, font: font.value })) }
  catch { progressText.value = '阅读设置未能保存在本机。' }
  void reflow()
}
function openPanel(value: 'contents' | 'settings') {
  priorFocus = document.activeElement as HTMLElement; panel.value = value
  nextTick(() => {
    root.value?.querySelector<HTMLElement>('.reader-panel input, .reader-panel button')?.focus()
    if (value === 'contents') root.value?.querySelector('.ant-tree-node-selected')?.scrollIntoView({ block: 'center' })
  })
}
function closePanel() { panel.value = undefined; priorFocus?.focus() }
function panelKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); closePanel() }
  if (event.key === 'Tab') {
    const elements = [...root.value!.querySelectorAll<HTMLElement>('.reader-panel button:not(:disabled), .reader-panel input, .reader-panel [tabindex="0"]')]
    if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
  }
}
async function chooseChapter(key: string) {
  const find = (nodes: ReadingChapter[]): ReadingChapter | undefined => {
    for (const node of nodes) { if (node.key === key) return node; const child = node.children && find(node.children); if (child) return child }
  }
  const chapter = find(book.value?.chapters || [])
  if (!chapter?.location) { warning.value = '该目录没有可用的正文位置。'; return }
  await jump({ ...chapter.location, encoding: encoding.value }); closePanel(); scroller.value?.focus()
}
async function adjacent(delta: number) {
  const chapter = flatChapters.value[Math.max(0, currentChapter.value + delta)]
  if (chapter?.location) await jump({ ...chapter.location, encoding: encoding.value })
}
async function toggleFullscreen() {
  if (document.fullscreenElement === root.value) { await document.exitFullscreen(); return }
  immersive.value = true
  if (!document.fullscreenEnabled || !root.value?.requestFullscreen) { progressText.value = '当前浏览器不支持系统全屏，已进入沉浸阅读。'; void reflow(); return }
  try { await root.value.requestFullscreen() }
  catch { progressText.value = '浏览器未允许系统全屏，已保留沉浸阅读。'; void reflow() }
}
function fullscreenChanged() { fullscreen.value = document.fullscreenElement === root.value; void reflow() }
async function exitImmersive() {
  if (document.fullscreenElement === root.value) await document.exitFullscreen()
  immersive.value = false; void reflow()
}
function visibility() { if (document.visibilityState === 'hidden') tracker.pause() }
function pageHidden() { tracker.pause() }
async function retryProgress() { await tracker.flush(); progressConflict.value = tracker.conflict }
async function adopt(server: boolean) {
  try {
    if (server) { const target = await tracker.adoptServer(); if (target) await jump(target, false) }
    else await tracker.adoptLocal()
    progressConflict.value = tracker.conflict
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '阅读位置核对失败。' }
}
async function loadText(bytes: Uint8Array): Promise<ReadingBook> {
  worker?.terminate()
  worker = new Worker(new URL('./text-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker!.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve({ ...event.data, close() {} })
    worker!.onerror = () => reject(new Error('书籍解析失败，请重试或下载原文件。'))
    worker!.postMessage({ bytes, encoding: encoding.value, markdown:isMarkdown.value }, [bytes.buffer])
  })
}
async function load() {
  const serial = ++epoch; busy.value = true; error.value = ''; restoring = true
  book.value?.close(); positions.clear(); book.value = undefined
  try {
    if (props.file.size > 50 * 1024 * 1024) throw new Error('书籍文件最大 50 MiB。')
    const response = await apiResponse(`/files/${props.file.id}/content?version=${props.file.version}`, { signal: abort.signal })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const result = isText.value ? await loadText(bytes) : await epubBook(bytes, abort.signal, text => { loadingText.value = text })
    if (isMarkdown.value) result.image = async href => {
      if (/^[a-z][a-z0-9+.-]*:|^\/|\\/i.test(href)) throw new Error('外部插图不自动加载。')
      const parts=props.file.path.split('/').slice(0,-1)
      for(const value of decodeURIComponent(href.split('#')[0]!).split('/')) { if(value==='..') {if(!parts.length) throw new Error('插图路径越界。'); parts.pop()} else if(value && value!=='.') parts.push(value) }
      const response=await apiResponse(`/files/content?path=${encodeURIComponent(parts.join('/'))}`,{signal:abort.signal})
      const blob=await response.blob()
      if(blob.size>8*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(blob.type)) throw new Error('插图格式或大小不支持。')
      return blob
    }
    if (disposed || serial !== epoch) { result.close(); return }
    positions.clear()
    result.chunks.forEach((chunk, chunkIndex) => chunk.blocks.forEach((block, blockIndex) => positions.set(`${block.part}:${block.index}`, {chunk:chunkIndex,block:blockIndex})))
    book.value = result; warning.value = result.warning; first.value = 0; last.value = Math.min(3, result.chunks.length - 1)
    heights.value = defaultHeights(); busy.value = false; await observeChunks()
    if (searchRestore) {
      const restored=matchUpdated(searchRestore); searchRestore=undefined
      await jump(restored.location,false)
      if(restored.precise) tracker.record(location.value!)
      else warning.value='内容已更新，原位置无法准确匹配，已回到对应章节或正文开头。'
      emit('updated',restored.precise)
    } else if (savedLocation.value) await jump(savedLocation.value, false)
    else {
      const first = result.chunks[0]?.blocks[0]
      location.value = first ? { v: 1, part: first.part, block: first.index, offset: 0, encoding: encoding.value } : undefined
      scroller.value!.scrollTop = 0; restoring = false
    }
    busy.value = false
  } catch (cause) { if (!disposed && serial === epoch) { error.value = cause instanceof Error ? cause.message : '书籍加载失败。'; busy.value = false } }
}

onMounted(async () => {
  compactQuery.addEventListener('change', compactChanged)
  try {
    const options = JSON.parse(localStorage.getItem(settingsKey) || 'null')
    if (options) {
      if (options.fontSize >= 14 && options.fontSize <= 32) fontSize.value = options.fontSize
      if (options.lineHeight >= 1.4 && options.lineHeight <= 2.6) lineHeight.value = options.lineHeight
      if (['paper','light','night'].includes(options.theme)) theme.value = options.theme
      if (['sans','serif'].includes(options.font)) font.value = options.font
    }
  } catch { /* Preferences are optional; the server-backed reading record is independent. */ }
  chunkResize = new ResizeObserver(() => { void measure() })
  resize = new ResizeObserver(() => {
    if (root.value && scroller.value) root.value.style.setProperty('--reader-viewport', `${scroller.value.clientHeight}px`)
    const width = scroller.value?.clientWidth || 0, changed = lastWidth !== 0 && lastWidth !== width
    lastWidth = width
    if (changed) { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (book.value && !busy.value) void reflow() }) }
  })
  if (scroller.value) resize.observe(scroller.value)
  document.addEventListener('fullscreenchange', fullscreenChanged)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pagehide', pageHidden)
  try {
    const resume = await tracker.open(); savedLocation.value = resume.location
    if(resume.changed) searchRestore=resume.previousLocation
    if (resume.location) encoding.value = resume.location.encoding
    if (resume.changed && !resume.previousLocation) warning.value = '书籍内容已变化，旧位置无法匹配，可从头阅读或选择章节。'
    await load()
    if (resume.changed && !resume.previousLocation) warning.value = '书籍内容已变化，旧位置无法匹配，可从头阅读或选择章节。'
  } catch (cause) { if (!disposed) { error.value = cause instanceof Error ? cause.message : '读取阅读进度失败。'; busy.value = false } }
})
onBeforeUnmount(() => {
  compactQuery.removeEventListener('change', compactChanged)
  disposed = true; ++epoch; abort.abort(); worker?.terminate(); book.value?.close(); tracker.close()
  resize?.disconnect(); chunkResize?.disconnect(); cancelAnimationFrame(scrollFrame); cancelAnimationFrame(resizeFrame)
  document.removeEventListener('fullscreenchange', fullscreenChanged); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pageHidden)
  if (document.fullscreenElement === root.value) void document.exitFullscreen()
})
watch(() => props.file, async (file,previous) => {
  if (file.version===previous.version && file.sha256===previous.sha256 && file.path===previous.path) return
  try {
    const target=capture() || location.value
    await tracker.sourceUpdated(file)
    if(disposed)return
    progressConflict.value=tracker.conflict
    if(!tracker.conflict)progressText.value='阅读位置自动保存'
    if(file.sha256!==previous.sha256) {searchRestore=target;savedLocation.value=undefined;await load()}
  } catch(cause) { if(!disposed) error.value=cause instanceof Error ? cause.message : '更新源文件失败。' }
})
defineExpose({ flush: () => tracker.flush(), isLoading: () => busy.value })
</script>

<template>
  <AConfigProvider :theme="readerAntTheme" :get-popup-container="popupContainer">
  <section ref="root" class="novel-reader" :class="[`reader-${theme}`, { 'reader-immersive': immersive, 'reader-minimal': minimal }]" :style="{ '--reader-font-size': `${fontSize}px`, '--reader-line-height': lineHeight, '--reader-font': font === 'serif' ? 'Georgia, SimSun, serif' : 'system-ui, sans-serif', '--reader-bg': readerColors.background, '--reader-text': readerColors.text, '--reader-border': readerColors.border }" aria-label="书籍阅读器" @keydown="readerKeys">
    <header v-show="!minimal || controlsVisible" class="reader-toolbar">
      <AButton v-if="immersive" aria-label="退出沉浸阅读" title="退出沉浸阅读" @click="exitImmersive"><ArrowLeft :size="18" /></AButton>
      <strong>{{ title }}</strong>
      <AButton title="章节目录" aria-label="章节目录" :disabled="busy" @click="openPanel('contents')"><List :size="18" /></AButton>
      <AButton title="阅读设置" aria-label="阅读设置" @click="openPanel('settings')"><Settings :size="18" /></AButton>
      <AButton v-if="!minimal" title="全屏阅读" aria-label="全屏阅读" @click="toggleFullscreen"><Shrink v-if="fullscreen" :size="18" /><Expand v-else :size="18" /></AButton>
      <AButton v-else title="收起阅读菜单" aria-label="收起阅读菜单" @click="controlsVisible=false"><X :size="18" /></AButton>
    </header>
    <AAlert v-if="error" type="error" show-icon :message="error" />
    <AAlert v-if="warning" type="info" show-icon :message="warning" closable @close="warning = ''" />
    <div v-if="progressConflict" class="reader-conflict"><span>其他页面或设备已更新阅读位置，本机位置已保留。</span><AButton @click="adopt(true)">采用服务器位置</AButton><AButton @click="adopt(false)">采用本机位置</AButton></div>
    <div ref="scroller" class="reader-scroll" tabindex="0" aria-label="书籍正文" :aria-busy="busy" @scroll.passive="scroll" @pointerdown="startTap" @pointerup="endTap" @pointercancel="tapStart=undefined;tapReady=false" @click="toggleReadingControls">
      <div v-if="busy" class="reader-loading" role="status"><ASpin /><p>{{ loadingText }}</p></div>
      <div v-else-if="book" class="reader-content">
        <div aria-hidden="true" :style="{ height: `${before}px` }" />
        <div v-for="chunk in visible" :key="chunk.index" class="reader-chunk" :data-chunk="chunk.index">
          <template v-for="block in chunk.blocks" :key="key(block)">
            <div v-if="block.image && book.image" data-reader-block :data-part="block.part" :data-block="block.index"><ReaderImage :load="() => book!.image!(block.image!)" :alt="block.text" /></div>
            <h2 v-else-if="block.heading" data-reader-block :data-part="block.part" :data-block="block.index">{{ block.text }}</h2>
            <p v-else data-reader-block :data-part="block.part" :data-block="block.index">{{ block.text }}</p>
          </template>
        </div>
        <div aria-hidden="true" :style="{ height: `${after}px` }" />
      </div>
    </div>
    <footer v-show="!minimal || controlsVisible" class="reader-footer"><AButton aria-label="上一章" title="上一章" :disabled="busy || currentChapter <= 0" @click="adjacent(-1)"><ChevronLeft :size="17" /></AButton><span class="reader-current-chapter">{{ flatChapters[currentChapter]?.title || '正文' }} · {{ percentage }}%</span><AButton aria-label="下一章" title="下一章" :disabled="busy || currentChapter + 1 >= flatChapters.length" @click="adjacent(1)"><ChevronRight :size="17" /></AButton><button class="reader-progress-status" type="button" title="重试保存阅读位置" @click="retryProgress">{{ progressText || '阅读位置自动保存' }}</button></footer>
    <div v-if="minimal && !controlsVisible && !panel" class="reader-minimal-bar" :class="{ 'reader-needs-attention': progressNeedsAttention }"><span :aria-hidden="progressNeedsAttention ? undefined : true" :role="progressNeedsAttention ? 'status' : undefined">{{ progressNeedsAttention ? progressText : `${flatChapters[currentChapter]?.title || '正文'} · ${percentage}%` }}</span><button type="button" aria-label="显示阅读菜单" @click="controlsVisible=true"><List :size="17" />菜单</button></div>
    <div v-if="panel" class="reader-panel-backdrop" @keydown="panelKeys">
      <section class="reader-panel" role="dialog" aria-modal="true" :aria-label="panel === 'contents' ? '书籍章节目录' : '书籍阅读设置'">
        <header><h2><BookOpen :size="19" />{{ panel === 'contents' ? '章节目录' : '阅读设置' }}</h2><AButton aria-label="关闭阅读面板" @click="closePanel"><X :size="18" /></AButton></header>
        <template v-if="panel === 'contents'">
          <AInput v-model:value="chapterQuery" aria-label="搜索章节名称" placeholder="搜索章节名称" allow-clear />
          <div class="reader-panel-scroll"><ATree v-if="chapterTree.length" :tree-data="chapterTree" :selected-keys="flatChapters[currentChapter] ? [flatChapters[currentChapter]!.key] : selected" default-expand-all block-node @select="(_keys, info) => chooseChapter(String(info.node.key))" /><p v-else>未找到章节，可关闭目录继续阅读。</p></div>
          <AButton v-if="location" @click="closePanel(); jump(location, false)">回到当前阅读位置</AButton>
        </template>
        <div v-else class="reader-settings reader-panel-scroll">
          <label>字号 {{ fontSize }}<ASlider v-model:value="fontSize" :min="14" :max="32" @after-change="setting" /></label>
          <label>行距 {{ lineHeight }}<ASlider v-model:value="lineHeight" :min="1.4" :max="2.6" :step="0.1" @after-change="setting" /></label>
          <label>字体<ASelect v-model:value="font" :options="[{value:'sans',label:'系统字体'},{value:'serif',label:'衬线字体'}]" @change="setting" /></label>
          <label>背景<ASelect v-model:value="theme" :options="[{value:'paper',label:'护眼纸色'},{value:'light',label:'浅色'},{value:'night',label:'夜间'}]" @change="setting" /></label>
          <label v-if="isText && !isMarkdown">文本编码<ASelect v-model:value="encoding" :options="['auto','UTF-8','GB18030','UTF-16LE','UTF-16BE'].map(value=>({value,label:value === 'auto' ? '自动（BOM / UTF-8）' : value}))" @change="savedLocation = undefined; load()" /></label>
          <AButton @click="closePanel(); immersive = !immersive; reflow()">{{ immersive ? '退出沉浸模式' : '进入沉浸模式' }}</AButton>
          <AButton v-if="savedLocation" @click="closePanel(); jump(savedLocation, false)">回到上次阅读位置</AButton>
          <p>阅读不会修改原文件。全屏受浏览器支持情况限制；本版不缓存整本书供离线打开。</p>
        </div>
      </section>
    </div>
  </section>
  </AConfigProvider>
</template>

<style scoped>
.novel-reader { --reader-bg: #f4efdf; --reader-text: #353329; display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; background: var(--reader-bg); color: var(--reader-text); }
.reader-light { --reader-bg: #fff; --reader-text: #252a28; }
.reader-night { --reader-bg: #202522; --reader-text: #d9dfd9; color-scheme: dark; }
.novel-reader.reader-immersive, .novel-reader:fullscreen { position: fixed; inset: 0; z-index: 90; width: 100%; height: 100dvh; }
.reader-toolbar { display: flex; align-items: center; flex-shrink: 0; gap: 8px; padding: max(8px, env(safe-area-inset-top)) 12px 8px; border-bottom: 1px solid #8883; }
.reader-toolbar strong { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.novel-reader :deep(.ant-btn) { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; min-height: 40px; }
.reader-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; overflow-anchor: none; scroll-behavior: auto; }
.reader-scroll:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.reader-content { max-width: 760px; margin: auto; padding: 24px 24px max(24px, calc(var(--reader-viewport, 70vh) - 100px)); font-family: var(--reader-font); font-size: var(--reader-font-size); line-height: var(--reader-line-height); overflow-wrap: anywhere; }
.reader-chunk { display: flow-root; }
.reader-content p { margin: 0 0 .75em; white-space: pre-wrap; text-indent: 2em; }
.reader-content h2 { margin: 1em 0 1.2em; font: inherit; font-weight: 600; font-size: 1.25em; }
.reader-footer { display: flex; align-items: center; flex-shrink: 0; flex-wrap: wrap; gap: 6px; padding: 6px 12px max(6px, env(safe-area-inset-bottom)); border-top: 1px solid #8883; font-size: 12px; }
.reader-current-chapter { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.reader-progress-status { border: 0; background: transparent; color: inherit; font-size: 11px; cursor: pointer; max-width: 100%; white-space: normal; text-align: left; }
.reader-loading { padding: 60px 24px; text-align: center; }
.reader-panel-backdrop { position: absolute; inset: 0; z-index: 10; display: flex; background: #0005; }
.novel-reader { position: relative; }
.reader-panel { display: flex; flex-direction: column; gap: 16px; width: min(360px, 94%); height: 100%; padding: 20px; background: var(--reader-bg); color: var(--reader-text); box-shadow: 4px 0 16px #0002; }
.reader-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.reader-panel h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 18px; }
.reader-panel-scroll { flex: 1; overflow: auto; min-height: 0; }
.reader-panel :deep(.ant-tree-title) { white-space: normal; overflow-wrap: anywhere; }
.reader-settings { display: flex; flex-direction: column; gap: 24px; }
.reader-settings label { display: flex; flex-direction: column; gap: 8px; }
.reader-settings p { color: inherit; opacity: .75; font-size: 12px; line-height: 1.8; }
.reader-panel :deep(.ant-tree) { background: transparent; }
.reader-toolbar, .reader-footer { background: var(--reader-bg); }
.reader-toolbar :deep(.ant-btn), .reader-footer :deep(.ant-btn) { background: transparent; border-color: transparent; box-shadow: none; color: var(--reader-text); }
.reader-toolbar :deep(.ant-btn:disabled), .reader-footer :deep(.ant-btn:disabled) { opacity: .35; }
.reader-minimal .reader-toolbar { position: absolute; inset: 0 0 auto; z-index: 3; border-color: var(--reader-border); }
.reader-minimal .reader-footer { position: absolute; inset: auto 0 0; z-index: 3; border-color: var(--reader-border); }
.reader-minimal .reader-content { padding-top: max(28px, env(safe-area-inset-top)); }
.reader-minimal-bar { position: absolute; inset: auto 0 0; display: flex; align-items: center; gap: 16px; padding: 8px max(16px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: var(--reader-bg); pointer-events: none; }
.reader-minimal-bar > span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; opacity: .7; }
.reader-minimal-bar.reader-needs-attention > span { white-space: normal; line-height: 1.6; opacity: 1; }
.reader-minimal-bar > button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 76px; min-height: 44px; padding: 8px 14px; border: 1px solid var(--reader-border); border-radius: 24px; background: var(--reader-bg); color: var(--reader-text); cursor: pointer; pointer-events: auto; }
.reader-minimal-bar > button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.reader-conflict { padding: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; }
@media (max-width: 600px) {
  .reader-toolbar { gap: 8px; padding-inline: 8px; }
  .reader-toolbar strong { font-size: 12px; }
  .novel-reader :deep(.ant-btn) { min-width: 44px; min-height: 44px; padding-inline: 8px; }
  .reader-footer { padding-inline: 8px; }
  .reader-progress-status { flex-basis: 100%; }
  .reader-panel { padding: 16px; }
}
</style>
