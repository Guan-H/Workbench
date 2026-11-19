<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import PdfDocumentView from '../document/PdfDocumentView.vue'
import ContentLoading from '../../shared/ContentLoading.vue'
import type { Note } from '../../shared/api/client'
import type { ReadingLocator } from './book'
import { ReadingProgress } from './reading-progress'
import BookHeading from './BookHeading.vue'

const props = defineProps<{ file: Note; username: string; bookTitle: string }>()
const emit = defineEmits<{ back: [] }>()
const viewer = ref<InstanceType<typeof PdfDocumentView>>()
const ready = ref(false), initialPage = ref(1), status = ref(''), conflict = ref(false), resolving = ref(false)
const abort = new AbortController()
const tracker = new ReadingProgress(props.file, props.username, message => {
  status.value = message
  conflict.value = tracker.conflict
})
let progressAvailable = false
let currentPage = 1

function pageOf(location?: ReadingLocator) {
  return location?.part === 'pdf' ? location.block + 1 : 1
}

function pageChanged(page: number) {
  if (!progressAvailable || page === currentPage) return
  currentPage = page
  tracker.record({ v: 1, part: 'pdf', block: page - 1, offset: 0, encoding: 'auto' })
}

async function adoptPosition(source: 'server' | 'local') {
  resolving.value = true
  try {
    if (source === 'server') {
      const position = await tracker.adoptServer()
      if (abort.signal.aborted) return
      currentPage = initialPage.value = pageOf(position)
      viewer.value?.goToPage(currentPage)
      status.value = '已采用服务器进度。'
    } else {
      await tracker.adoptLocal()
    }
  } catch (cause) {
    status.value = cause instanceof Error ? cause.message : '读取阅读进度失败，请重试。'
  } finally {
    conflict.value = tracker.conflict
    resolving.value = false
  }
}

function pauseWhenHidden() {
  if (document.visibilityState === 'hidden') tracker.pause()
}

onMounted(async () => {
  document.addEventListener('visibilitychange', pauseWhenHidden)
  window.addEventListener('pagehide', pageHidden)
  try {
    const progress = await tracker.open(AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]))
    if (abort.signal.aborted) return
    currentPage = initialPage.value = pageOf(progress.location)
    progressAvailable = true
    if (progress.changed && !status.value) status.value = 'PDF 内容已更新，当前从第一页开始。'
  } catch {
    if (!abort.signal.aborted) status.value = '暂时无法读取上次页码，重新打开后可重试。'
  } finally {
    if (!abort.signal.aborted) ready.value = true
  }
})

function pageHidden() { tracker.pause() }

onBeforeUnmount(() => {
  abort.abort()
  document.removeEventListener('visibilitychange', pauseWhenHidden)
  window.removeEventListener('pagehide', pageHidden)
  tracker.close()
})

defineExpose({ flush: () => tracker.flush(), isLoading: () => !ready.value || (viewer.value?.isLoading() ?? true) })
</script>

<template>
  <div class="pdf-book-reader">
    <template v-if="!ready">
      <BookHeading class="pdf-loading-heading" :title="bookTitle" show-back @back="emit('back')" />
      <ContentLoading label="正在读取阅读进度…" />
    </template>
    <PdfDocumentView v-else ref="viewer" :id="file.id" :version="file.version" :name="file.path" :initial-page="initialPage" bookshelf @page-change="pageChanged">
      <template #book-heading><BookHeading :title="bookTitle" show-back @back="emit('back')" /></template>
    </PdfDocumentView>
    <div v-if="status" class="pdf-book-progress">
      <span role="status">{{ status }}</span>
      <template v-if="conflict">
        <AButton size="small" :disabled="resolving" @click="adoptPosition('server')">采用服务器位置</AButton>
        <AButton size="small" :disabled="resolving" @click="adoptPosition('local')">采用本机位置</AButton>
      </template>
      <AButton v-else-if="progressAvailable && !tracker.fileChanged && status.includes('重试')" size="small" @click="tracker.flush()">重试保存进度</AButton>
    </div>
  </div>
</template>

<style scoped>
.pdf-book-reader { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.pdf-book-reader :deep(.pdf-document-view) { flex: 1; height: auto; }
.pdf-loading-heading { padding: 6px 12px; border-bottom: 1px solid var(--color-border); }
.pdf-book-progress { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 12px; font-size: 13px; }
</style>
