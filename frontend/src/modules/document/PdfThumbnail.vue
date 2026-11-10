<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

const props = defineProps<{ document: PDFDocumentProxy; number: number; rotation: number; active: boolean }>()
const emit = defineEmits<{ navigate: [page: number] }>()
const button = ref<HTMLButtonElement>(), canvas = ref<HTMLCanvasElement>(), failed = ref(false)
let observer: IntersectionObserver | undefined, task: RenderTask | undefined
let visible = false, disposed = false, generation = 0

async function draw() {
  const serial = ++generation
  task?.cancel()
  try {
    if (task) await task.promise.catch(() => undefined)
    if (!visible || disposed || serial !== generation) return
    const page = await props.document.getPage(props.number)
    if (disposed || serial !== generation || !canvas.value) return
    const base = page.getViewport({ scale: 1, rotation: (page.rotate + props.rotation) % 360 })
    const viewport = page.getViewport({ scale: 130 / base.width, rotation: base.rotation })
    canvas.value.width = Math.ceil(viewport.width)
    canvas.value.height = Math.ceil(viewport.height)
    task = page.render({ canvas: canvas.value, viewport, annotationMode: 1 })
    await task.promise
    if (serial === generation) failed.value = false
  } catch { if (!disposed && serial === generation) failed.value = true }
}

watch(() => props.rotation, () => { void draw() })
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    if (visible) void draw()
    else {
      ++generation; task?.cancel()
      // Off-screen previews do not retain a full canvas for every page in a long PDF.
      if (canvas.value) { canvas.value.width = 0; canvas.value.height = 0 }
    }
  }, { root: button.value?.closest('.pdf-sidebar-scroll'), rootMargin: '150px' })
  if (button.value) observer.observe(button.value)
})
onBeforeUnmount(() => { disposed = true; ++generation; observer?.disconnect(); task?.cancel() })
</script>

<template>
  <button ref="button" type="button" class="pdf-thumbnail" :class="{ active }" :aria-label="`跳转到第 ${number} 页`" :aria-current="active ? 'page' : undefined" @click="emit('navigate', number)">
    <span class="pdf-thumbnail-paper"><canvas ref="canvas" aria-hidden="true" /><span v-if="failed">缩略图加载失败</span></span>
    <span>第 {{ number }} 页</span>
  </button>
</template>

<style scoped>
.pdf-thumbnail { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; padding: 12px; color: var(--color-text); border: 2px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; }
.pdf-thumbnail:hover { background: var(--color-background); }
.pdf-thumbnail.active { border-color: var(--color-primary); background: var(--color-selection); }
.pdf-thumbnail:focus-visible { outline: 2px solid var(--color-primary, #377b60); outline-offset: -3px; }
.pdf-thumbnail-paper { display: flex; align-items: center; justify-content: center; width: 132px; min-height: 100px; background: white; box-shadow: 0 1px 5px #0002; }
canvas { display: block; max-width: 130px; }
</style>
