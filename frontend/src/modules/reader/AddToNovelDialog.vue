<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Select as ASelect, Spin as ASpin } from 'ant-design-vue'
import { onMounted, ref } from 'vue'
import { api, write, type Note } from '../../shared/api/client'
import AppDialog from '../../shared/AppDialog.vue'
import { folderOptions, type NovelLibrary, type LibraryChange } from './library'
const props = defineProps<{ file: Note }>()
const emit = defineEmits<{ close: []; added: [] }>()
const library = ref<NovelLibrary>(), target = ref(''), busy = ref(false), error = ref(''), pending = ref<LibraryChange>()
const operation = crypto.randomUUID()
onMounted(async () => { try { library.value = await api<NovelLibrary>('/reader/library') } catch(cause) { error.value = cause instanceof Error ? cause.message : '读取书籍目录失败。' } })
async function submit() {
  if (!library.value || busy.value) return
  busy.value = true; error.value = ''
  pending.value ||= {baseRevision:library.value.revision,action:'add-book',id:props.file.id,parentId:target.value}
  try { await write('/reader/library','POST',pending.value,operation); emit('added') }
  catch(cause) { error.value = cause instanceof Error ? cause.message : '加入结果尚未确认，请使用同一操作重试。' }
  finally { busy.value = false }
}
</script>
<template><AppDialog label="复制到书架"><section class="modal reading-library-dialog"><header><h2>复制到书架</h2><AButton :disabled="busy" @click="emit('close')">关闭</AButton></header><div class="novel-copy-body"><p>{{ file.path }}</p><p>选择独立的书籍目录。正文仍是同一文件，笔记修改后阅读会自动更新。</p><ASpin v-if="!library && !error" /><label v-if="library">书籍目录<ASelect v-model:value="target" aria-label="选择书籍目录" :disabled="busy || !!pending" :options="folderOptions(library.folders)" show-search option-filter-prop="label" /></label><AAlert v-if="error" type="error" show-icon :message="error" /></div><footer><AButton :disabled="busy" @click="emit('close')">取消</AButton><AButton type="primary" :loading="busy" :disabled="!library" @click="submit">{{ pending ? '重试确认' : '确认加入书架' }}</AButton></footer></section></AppDialog></template>
<style scoped>.novel-copy-body { padding: 16px 24px; display: grid; gap: 12px; } p { margin: 0; overflow-wrap: anywhere; line-height: 1.8; } label { display: grid; gap: 8px; }</style>
