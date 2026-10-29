<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ChevronDown, Folder, X } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'
import DirectoryTree from './DirectoryTree.vue'

const props = withDefaults(defineProps<{ id?: string; modelValue: string; items: Note[]; disabled: boolean; title?: string }>(), { title: '选择导入目标目录' })
const emit = defineEmits<{ 'update:modelValue': [path: string] }>()
const opened = ref(false)
const candidate = ref('')
const query = ref('')
const panel = ref<HTMLElement>()
let previous: HTMLElement | null = null
const folders = computed(() => props.items.filter(item => item.type === 'folder' && !item.deleted))
async function open() {
  if (props.disabled) return
  previous = document.activeElement as HTMLElement
  candidate.value = props.modelValue; query.value = ''; opened.value = true
  await nextTick(); panel.value?.querySelector('input')?.focus()
}
function close() { opened.value = false; if (previous?.isConnected) previous.focus() }
function select() {
  if (candidate.value && !folders.value.some(folder => folder.path === candidate.value)) return
  emit('update:modelValue', candidate.value); close()
}
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault()
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab') return
  const controls = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
</script>
<template>
  <div class="directory-picker">
    <button :id="id" class="directory-picker-trigger" :aria-label="title" :disabled="disabled" :aria-expanded="opened" aria-haspopup="dialog" @click="open"><Folder :size="18" aria-hidden="true" /><span>{{ modelValue || '根目录 /' }}</span><ChevronDown :size="16" aria-hidden="true" /></button>
    <div v-if="opened" class="modal-backdrop directory-picker-backdrop" @dragover.prevent @drop.prevent.stop>
      <section ref="panel" class="modal directory-picker-dialog" role="dialog" aria-modal="true" :aria-label="title" @keydown="key">
        <header><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭目录选择" title="关闭目录选择" @click="close"><X :size="18" /></button></header>
        <div class="directory-picker-body">
          <label for="directory-query">查找目录</label><input id="directory-query" v-model="query" placeholder="输入目录路径" />
          <p class="field-help">这里只显示已有目录；选择根目录或文件夹后确认。</p>
          <div class="directory-picker-scroll"><button class="directory-choice" :class="{ active: !candidate }" :aria-pressed="!candidate" @click="candidate = ''"><Folder :size="17" />根目录 /</button><DirectoryTree :folders="folders" :selected="candidate" :query="query" @select="candidate = $event" /></div>
          <p class="field-help">已选：{{ candidate || '根目录 /' }}</p>
        </div>
        <footer><button @click="close">取消</button><button class="primary" @click="select">使用此目录</button></footer>
      </section>
    </div>
  </div>
</template>
