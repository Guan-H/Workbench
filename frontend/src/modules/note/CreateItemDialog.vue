<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { write, ApiError, type Note } from '../../shared/api/client'
import DirectoryPicker from './DirectoryPicker.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'

const props = defineProps<{ type: 'note' | 'folder'; destination: string; items: Note[] }>()
const emit = defineEmits<{ close: []; created: [note: Note] }>()
const panel = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const name = ref(props.type === 'folder' ? '新建文件夹' : '新建笔记.md')
const target = ref(props.destination)
const error = ref('')
const busy = ref(false)
const uncertain = ref(false)
const closing = ref(false)
const previous = document.activeElement as HTMLElement
const title = computed(() => props.type === 'folder' ? '新建文件夹' : '新建笔记')
const fileName = computed(() => props.type === 'note' && !/\.md$/i.test(name.value) ? name.value + '.md' : name.value)
const path = computed(() => (target.value ? target.value + '/' : '') + fileName.value)
let operation = crypto.randomUUID()
let submitted: { path: string; type: 'note' | 'folder'; content: string } | undefined

watch([name, target], () => { error.value = ''; operation = crypto.randomUUID() })
function invalidName() {
  if (!name.value.trim()) return '请输入名称。'
  if (/[\\/<>:"|?*\u0000-\u001f\u007f]/.test(name.value)) return '名称不能包含 /、\\、<、>、:、"、|、?、* 或控制字符。'
  if (/[. ]$/.test(name.value) || /^\.{1,2}$/.test(name.value)) return '名称不能以空格或句点结尾。'
  if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i.test(name.value) || /^\.(git|obsidian)$/i.test(name.value)) return '该名称属于系统保留名称，请换一个。'
  if (path.value.length > 240 || name.value.normalize('NFC') !== name.value) return '完整路径过长或名称编码不符合要求，请调整名称或位置。'
  return ''
}
async function create() {
  if (busy.value) return
  if (!uncertain.value) {
    error.value = invalidName()
    if (error.value) { input.value?.focus(); return }
    submitted = { path: path.value, type: props.type, content: '' }
  }
  if (!submitted) return
  busy.value = true; error.value = ''
  try { emit('created', await write<Note>('/notes', 'POST', submitted, operation)) }
  catch (cause) {
    uncertain.value = !(cause instanceof ApiError) || cause.status >= 500
    error.value = uncertain.value ? '创建结果尚未确认，请保持名称和位置不变，点击“重试确认”。' : (cause as Error).message
  } finally { busy.value = false }
}
function close() {
  if (busy.value) return
  if (uncertain.value) closing.value = true
  else emit('close')
}
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault()
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key === 'Enter' && event.target === input.value && !event.isComposing) { event.preventDefault(); void create() }
  if (event.key !== 'Tab') return
  const controls = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
function unloading(event: BeforeUnloadEvent) { if (busy.value || uncertain.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(async () => {
  addEventListener('beforeunload', unloading)
  await nextTick(); input.value?.focus(); input.value?.setSelectionRange(0, props.type === 'note' ? name.value.length - 3 : name.value.length)
})
onBeforeUnmount(() => { removeEventListener('beforeunload', unloading); if (previous?.isConnected) previous.focus() })
</script>
<template>
  <div class="modal-backdrop">
    <section ref="panel" class="modal create-dialog" role="dialog" aria-modal="true" :aria-label="title" @keydown="key">
      <header><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭新建" title="关闭新建" :disabled="busy" @click="close"><X :size="18" /></button></header>
      <div class="create-body">
        <label for="create-name">{{ type === 'folder' ? '文件夹名称' : '笔记名称' }}</label>
        <input id="create-name" ref="input" v-model="name" :disabled="busy || uncertain" :aria-invalid="!!error" aria-describedby="create-name-help create-error" autocomplete="off" />
        <p id="create-name-help" class="field-help">只填写名称；{{ type === 'note' ? '未填写 .md 后缀时自动补齐。' : '子目录位置请在下方选择。' }}</p>
        <p v-if="error" id="create-error" class="error-message" role="alert">{{ error }}</p>
        <label for="create-location">创建位置</label>
        <DirectoryPicker id="create-location" v-model="target" :items="items" :disabled="busy || uncertain" title="选择创建位置" />
        <p class="field-help create-path">创建后：{{ path }}</p>
        <p v-if="busy" role="status">正在等待服务器确认…</p>
      </div>
      <footer><button :disabled="busy" @click="close">取消</button><button class="primary" :disabled="busy" @click="create">{{ uncertain ? '重试确认' : busy ? '创建中…' : '创建' }}</button></footer>
    </section>
    <ConfirmDialog v-if="closing" title="关闭新建" message="创建结果尚未确认，关闭后请先刷新目录核对。仍要关闭吗？" confirm-label="关闭新建" @answer="value => { closing = false; if (value) emit('close') }" />
  </div>
</template>
