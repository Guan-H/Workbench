<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Dropdown as ADropdown, Input as AInput, Menu as AMenu, MenuItem as AMenuItem, Select as ASelect, Tree as ATree } from 'ant-design-vue'
import { ArrowLeft, BookOpen, Ellipsis, FolderPlus, RefreshCw, Search, Upload, X } from 'lucide-vue-next'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, write, uploadRequest, ApiError, type Note, type UploadProgress } from '../../shared/api/client'
import AppDialog from '../../shared/AppDialog.vue'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import AppPagination from '../../shared/AppPagination.vue'
import UploadProgressBar from '../../shared/UploadProgressBar.vue'
import { folderOptions, folderPath, type LibraryChange, type NovelBook, type NovelLibrary } from './library'
const NovelReader = defineAsyncComponent(() => import('./NovelReader.vue'))
const props = defineProps<{ username:string; requestedFile?:Note }>()
const emit = defineEmits<{uploaded:[file:Note]}>()
const reader=ref<{flush:()=>Promise<void>;isLoading:()=>boolean}>(),current=ref<Note>(),input=ref<HTMLInputElement>()
const library=ref<NovelLibrary>({revision:'0',folders:[],books:[]}),loading=ref(true),folder=ref(''),query=ref(''),page=ref(1),opening=ref(false),error=ref(''),notice=ref<Notice>()
const uploadFile=ref<File>(),destination=ref(''),uploading=ref(false),uploadProgress=ref<UploadProgress>(),uncertain=ref(false)
const editor=ref<{action:LibraryChange['action'];id?:string;name:string;parentId:string;revision:string;operation:string;pending?:LibraryChange}>(),changing=ref(false)
let serial=0,uploadOperation='',uploadRevision='',noticeTimer:ReturnType<typeof setTimeout>|undefined,disposed=false,polling=false,pollTimer:ReturnType<typeof setInterval>|undefined
const name=(book:NovelBook)=>(book.file?.path || book.sourcePath).split('/').at(-1) || book.sourcePath
const filtered=computed(()=>library.value.books.filter(book=>query.value ? `${name(book)} ${book.file?.path||book.sourcePath} ${folderPath(book.folderId,library.value.folders)}`.toLowerCase().includes(query.value.trim().toLowerCase()) : book.folderId===folder.value).sort((a,b)=>name(a).localeCompare(name(b),'zh-CN')))
const pages=computed(()=>Math.max(1,Math.ceil(filtered.value.length/10)))
const visible=computed(()=>filtered.value.slice((page.value-1)*10,page.value*10))
interface FolderNode {key:string;title:string;children?:FolderNode[]}
const tree=computed(()=>{
  const children=(parent:string):FolderNode[]=>library.value.folders.filter(item=>item.parentId===parent).map(item=>({key:item.id,title:item.name,children:children(item.id)}))
  return children('')
})
watch([query,folder],()=>{page.value=1})
watch(pages,value=>{page.value=Math.min(page.value,value)})
watch(()=>props.requestedFile,file=>{if(file) void open(file.id)},{immediate:true})
function notify(text:string) {notice.value={kind:'success',text};clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.value=undefined},2000)}
async function refresh() {
  loading.value=true
  try {library.value=await api<NovelLibrary>('/reader/library');error.value='';if(folder.value&&!library.value.folders.some(item=>item.id===folder.value)) folder.value=''}
  catch(cause){error.value=cause instanceof Error?cause.message:'读取书籍目录失败。'}
  finally{loading.value=false}
}
async function open(id:string) {
  const request=++serial;opening.value=true;error.value='';await reader.value?.flush()
  try {const latest=await api<Note>(`/reader/library/files/${id}`);if(!disposed&&request===serial)current.value=latest}
  catch(cause){if(!disposed&&request===serial)error.value=cause instanceof Error?cause.message:'书籍打开失败。'}
  finally{if(!disposed&&request===serial)opening.value=false}
}
async function books() {++serial;await reader.value?.flush();current.value=undefined;opening.value=false;await refresh()}
async function poll() {
  if(polling||!current.value||reader.value?.isLoading()||document.visibilityState==='hidden')return
  polling=true;const id=current.value.id
  try{
    const latest=await api<Note>(`/reader/library/files/${id}`,{signal:AbortSignal.timeout(10000)})
    if(!disposed&&current.value?.id===id&&(latest.version!==current.value.version||latest.path!==current.value.path))current.value=latest
  }catch(cause){
    if(!disposed&&current.value?.id===id&&cause instanceof ApiError&&cause.status===404){current.value=undefined;error.value='书籍入口或源文件已移除，恢复源文件或重新加入后可继续。';await refresh();error.value='书籍入口或源文件已移除，恢复源文件或重新加入后可继续。'}
  }finally{polling=false}
}
function edit(action:LibraryChange['action'],book?:NovelBook) {
  const selected=library.value.folders.find(item=>item.id===folder.value)
  editor.value={action,id:book?.fileId||selected?.id,name:action==='create-folder'?'':selected?.name||'',parentId:book?.folderId||(action==='create-folder'?folder.value:selected?.parentId||''),revision:library.value.revision,operation:crypto.randomUUID()};error.value=''
}
async function change() {
  const value=editor.value;if(!value||changing.value)return
  changing.value=true;error.value=''
  value.pending||={baseRevision:value.revision,action:value.action,id:value.id,parentId:value.parentId,name:value.name}
  try {await write('/reader/library','POST',value.pending,value.operation);editor.value=undefined;await refresh();notify('书籍目录已更新。')}
  catch(cause){error.value=cause instanceof Error?cause.message:'操作未确认，请使用同一操作重试。'}
  finally{changing.value=false}
}
function selected(event:Event) {
  const control=event.target as HTMLInputElement,file=control.files?.[0];control.value=''
  if(!file)return
  if(!/\.(txt|epub|md)$/i.test(file.name)||file.size>50*1024*1024){error.value='请选择不超过 50 MiB 的 TXT、EPUB 或 Markdown；Markdown 沿用 1 MiB 笔记限制。';return}
  uploadFile.value=file;destination.value=folder.value;error.value='';uncertain.value=false;uploadOperation=crypto.randomUUID();uploadRevision=library.value.revision
}
async function upload() {
  const file=uploadFile.value;if(!file||uploading.value)return
  uploading.value=true;error.value=''
  const form=new FormData();form.append('name',file.name);form.append('parentId',destination.value);form.append('baseRevision',uploadRevision);form.append('file',file,file.name)
  try{
    const saved=await uploadRequest<{id:string}>('/reader/library/upload',form,value=>{uploadProgress.value=value},{'Idempotency-Key':uploadOperation})
    if(disposed)return
    uploadFile.value=undefined;uncertain.value=false;await refresh();const file=await api<Note>(`/reader/library/files/${saved.id}`);emit('uploaded',file);notify('书籍已上传。');await open(saved.id)
  }catch(cause){if(!disposed){uncertain.value=true;error.value=(cause instanceof Error?cause.message:'上传未确认。')+' 可使用同一操作重试；关闭后请先刷新核对。'}}
  finally{if(!disposed){uploading.value=false;uploadProgress.value=undefined}}
}
onMounted(()=>{void refresh();pollTimer=setInterval(()=>{void poll()},5000);window.addEventListener('focus',poll);document.addEventListener('visibilitychange',poll)})
onBeforeUnmount(()=>{disposed=true;++serial;clearTimeout(noticeTimer);clearInterval(pollTimer);window.removeEventListener('focus',poll);document.removeEventListener('visibilitychange',poll)})
defineExpose({prepareLeave:async()=>{if(uploading.value||changing.value)return false;await reader.value?.flush();return true}})
</script>

<template>
  <section class="reading-page" aria-label="阅读页面">
    <AppMessage :notice="notice" @close="notice=undefined" />
    <div v-if="current" class="reading-book-header"><AButton @click="books"><ArrowLeft :size="16" />返回书目</AButton><a :href="`/api/v1/files/${current.id}/content?version=${current.version}`" target="_blank" rel="noopener noreferrer">下载原文件</a></div>
    <div v-else class="reading-library-header"><div><p>我的阅读</p><h1>书籍目录</h1><span>独立管理书籍分类；加入的笔记共用同一份正文，修改后自动更新。</span></div><div class="reading-header-actions"><AButton @click="edit('create-folder')"><FolderPlus :size="16" />新建目录</AButton><AButton type="primary" @click="input?.click()"><Upload :size="16" />上传书籍</AButton></div></div>
    <input ref="input" type="file" accept=".txt,.epub,.md" hidden @change="selected">
    <AAlert v-if="error" type="error" show-icon :message="error" />
    <p v-if="opening" role="status" class="reading-opening">正在打开书籍…</p>
    <NovelReader v-if="current" ref="reader" :key="current.id" :file="current" :username="username" @updated="notify('已同步源文件修改。')" />
    <template v-else>
      <div class="reading-library-tools"><AInput v-model:value="query" aria-label="搜索阅读书目" placeholder="搜索书籍或源文件路径" allow-clear><template #prefix><Search :size="16" /></template></AInput><AButton :loading="loading" aria-label="刷新书目" title="刷新书目" @click="refresh"><RefreshCw :size="16" /></AButton><span>{{ filtered.length }} 本</span></div>
      <div class="novel-mobile-folder"><label>书籍目录<ASelect v-model:value="folder" aria-label="当前书籍目录" :options="folderOptions(library.folders)" /></label></div>
      <div class="novel-browser">
        <aside class="novel-folders" aria-label="独立书籍目录"><AButton :type="!folder?'primary':'default'" @click="folder=''">书籍根目录 /</AButton><ATree :tree-data="tree" :selected-keys="[folder]" block-node @select="(_keys,info)=>folder=String(info.node.key)" /></aside>
        <div class="novel-folder-body"><div class="novel-folder-heading"><strong>{{ folderPath(folder,library.folders)||'书籍根目录 /' }}</strong><template v-if="folder"><AButton size="small" @click="edit('update-folder')">编辑目录</AButton><AButton size="small" danger @click="edit('delete-folder')">删除目录</AButton></template></div>
          <div class="reading-library-scroll" :aria-busy="loading"><p v-if="loading&&!library.books.length" role="status">正在读取书籍目录…</p><div v-else-if="!filtered.length" class="reading-empty"><BookOpen :size="40" /><h2>当前没有书籍</h2><p>在笔记中右键“复制到书架”，或在这里上传；笔记目录不会自动加入。</p></div>
            <ul v-else class="reading-books"><li v-for="book in visible" :key="book.fileId"><button type="button" :data-reading-path="book.file?.path||book.sourcePath" :aria-label="`阅读 ${book.file?.path||book.sourcePath}`" :disabled="!book.file" @click="open(book.fileId)"><span class="reading-book-icon"><BookOpen :size="23" /></span><span class="reading-book-info"><strong>{{ name(book) }}</strong><small>目录：{{ folderPath(book.folderId,library.folders)||'根目录' }}</small><small>源文件：{{ book.file?.path||book.sourcePath }}{{ !book.file?'（已删除或不可用）':'' }}</small></span></button><ADropdown :trigger="['click']"><AButton type="text" :aria-label="`书籍操作：${name(book)}`" title="书籍操作"><Ellipsis :size="19" /></AButton><template #overlay><AMenu><AMenuItem @click="edit('move-book',book)">移动分类</AMenuItem><AMenuItem danger @click="edit('remove-book',book)">从书架移除</AMenuItem></AMenu></template></ADropdown></li></ul>
          </div>
          <footer class="reading-pagination"><span>共 {{ filtered.length }} 本 · 第 {{ page }} / {{ pages }} 页 · 10 本/页</span><AppPagination v-model:page="page" :pages="pages" :total="filtered.length" :page-size="10" :disabled="loading" /></footer>
        </div>
      </div>
    </template>
    <AppDialog v-if="editor" label="管理阅读目录"><section class="modal reading-library-dialog"><header><h2>{{ editor.action==='create-folder'?'新建目录':editor.action==='update-folder'?'编辑目录':editor.action==='delete-folder'?'删除目录':editor.action==='move-book'?'移动书籍分类':'从书架移除' }}</h2><AButton :disabled="changing" @click="editor=undefined">关闭</AButton></header><div class="novel-edit-body"><template v-if="editor.action==='create-folder'||editor.action==='update-folder'"><label>目录名称<AInput v-model:value="editor.name" aria-label="书籍目录名称" :disabled="changing||!!editor.pending" /></label></template><label v-if="!['delete-folder','remove-book'].includes(editor.action)">目标书籍目录<ASelect v-model:value="editor.parentId" aria-label="目标书籍目录" :disabled="changing||!!editor.pending" :options="folderOptions(library.folders)" show-search option-filter-prop="label" /></label><p v-if="editor.action==='delete-folder'">确认删除该书籍目录及子目录、其中的书籍入口？源文件和阅读记录保留。</p><p v-if="editor.action==='remove-book'">只移除书籍入口，不删除笔记源文件或阅读记录。</p><AAlert v-if="error" type="error" :message="error" /></div><footer><AButton :disabled="changing" @click="editor=undefined">取消</AButton><AButton type="primary" :loading="changing" @click="change">{{ editor.pending?'重试确认':'确认' }}</AButton></footer></section></AppDialog>
    <AppDialog v-if="uploadFile" label="上传书籍"><section class="modal reading-library-dialog"><header><h2>上传书籍</h2><AButton :disabled="uploading" aria-label="关闭书籍上传" @click="uploadFile=undefined"><X :size="18" /></AButton></header><div class="novel-edit-body"><p>{{ uploadFile.name }} · {{ (uploadFile.size/1024).toFixed(1) }} KiB</p><p>保存到独立书籍目录；正文仍由文件库统一保存，同名源文件不会覆盖。</p><label>书籍目录<ASelect v-model:value="destination" aria-label="上传到书籍目录" :disabled="uploading||uncertain" :options="folderOptions(library.folders)" show-search option-filter-prop="label" /></label><UploadProgressBar v-if="uploadProgress" :progress="uploadProgress" label="书籍上传" /><AAlert v-if="error" type="error" :message="error" /></div><footer><AButton :disabled="uploading" @click="uploadFile=undefined">关闭</AButton><AButton type="primary" :loading="uploading" @click="upload">{{ uncertain?'重试确认上传':'确认上传书籍' }}</AButton></footer></section></AppDialog>
  </section>
</template>

<style scoped>
.reading-page {display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}
.reading-library-header {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:24px 28px 20px}
.reading-library-header p {margin:0 0 6px;color:var(--color-primary);font-size:12px}.reading-library-header h1 {margin:0 0 10px;font-size:25px;font-weight:600}.reading-library-header span {color:var(--color-text-muted);font-size:13px;line-height:1.8}
.reading-header-actions {display:flex;gap:8px;flex-wrap:wrap}.reading-library-tools {display:flex;align-items:center;gap:12px;padding:0 28px 16px}.reading-library-tools :deep(.ant-input-affix-wrapper){max-width:420px}.reading-library-tools>span:last-child {flex-shrink:0;font-size:12px;color:var(--color-text-muted)}
.novel-browser {display:flex;flex:1;min-height:0;border-top:1px solid var(--color-border)}.novel-folders {width:220px;flex-shrink:0;overflow:auto;padding:16px;border-right:1px solid var(--color-border)}.novel-folders>:deep(.ant-btn){width:100%;margin-bottom:12px}.novel-folders :deep(.ant-tree-title){white-space:normal;overflow-wrap:anywhere}.novel-folder-body {flex:1;min-width:0;display:flex;flex-direction:column}.novel-folder-heading {display:flex;align-items:center;gap:8px;padding:12px 20px;flex-wrap:wrap}.novel-folder-heading strong {flex:1;min-width:100px;font-size:14px;overflow-wrap:anywhere}
.reading-library-scroll {flex:1;min-height:0;overflow:auto;padding:0 20px}.reading-books {list-style:none;margin:0;padding:0;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px}.reading-books li {display:flex;align-items:center;padding-right:8px}.reading-books li+li {border-top:1px solid var(--color-border)}.reading-books button[data-reading-path] {display:flex;align-items:center;gap:14px;flex:1;min-width:0;border:0;background:transparent;padding:16px;text-align:left;cursor:pointer;color:var(--color-text)}.reading-books button[data-reading-path]:hover {background:var(--color-selection)}.reading-books button:focus-visible {outline:2px solid var(--color-primary);outline-offset:-2px}.reading-books button:disabled {opacity:.6;cursor:not-allowed}.reading-book-icon {display:grid;place-items:center;width:44px;height:54px;border-radius:6px;background:var(--color-selection);color:var(--color-primary);flex-shrink:0}.reading-book-info {display:grid;gap:6px;min-width:0}.reading-book-info strong {font-size:15px;font-weight:500;overflow-wrap:anywhere}.reading-book-info small {font-size:12px;color:var(--color-text-muted);overflow-wrap:anywhere}
.reading-pagination {display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 20px;border-top:1px solid var(--color-border);margin-top:16px}.reading-pagination>span {font-size:12px;color:var(--color-text-muted)}.reading-book-header {display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;border-bottom:1px solid var(--color-border)}.reading-book-header a {font-size:12px}.reading-empty {padding:60px 20px;text-align:center;color:var(--color-text-muted)}.reading-empty h2 {font-size:18px;color:var(--color-text);font-weight:500}.reading-empty svg {color:var(--color-primary)}.reading-opening {padding:8px 28px;font-size:13px}.novel-edit-body {padding:16px 24px;display:grid;gap:12px}.novel-edit-body label {display:grid;gap:8px}.novel-edit-body p {line-height:1.8;overflow-wrap:anywhere}.novel-mobile-folder {display:none}
@media(max-width:700px){.reading-library-header{padding:20px 16px 16px}.reading-library-tools{padding-inline:16px;gap:8px}.novel-folders{display:none}.novel-mobile-folder{display:block;padding:0 16px 12px}.novel-mobile-folder label{display:grid;gap:6px}.reading-library-scroll{padding-inline:12px}.reading-pagination{padding-inline:12px}.reading-books button[data-reading-path]{padding:14px 10px;gap:10px}.reading-page :deep(.ant-btn){min-height:40px}}
</style>
