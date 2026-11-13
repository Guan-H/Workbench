<script setup lang="ts">
import { computed } from 'vue'
import { BookOpenText, FileCode2, FileImage, FileSpreadsheet, FileText, FileType2, Folder, FolderOpen, Paperclip } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  path: string
  type?: 'note' | 'folder' | 'attachment'
  expanded?: boolean
  size?: number
}>(), { type: 'attachment', expanded: false, size: 16 })

const appearance = computed(() => {
  if (props.type === 'folder') return { kind: 'folder', icon: props.expanded ? FolderOpen : Folder, label: '文件夹' }
  const extension = props.path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase()
  switch (extension) {
    case 'md': case 'markdown': return { kind: 'markdown', icon: FileCode2, label: 'Markdown 笔记' }
    case 'txt': return { kind: 'text', icon: FileText, label: 'TXT 文本' }
    case 'pdf': return { kind: 'pdf', icon: FileText, label: 'PDF 文档' }
    case 'doc': case 'docx': return { kind: 'word', icon: FileType2, label: 'Word 文档' }
    case 'xls': case 'xlsx': return { kind: 'excel', icon: FileSpreadsheet, label: 'Excel 表格' }
    case 'epub': return { kind: 'book', icon: BookOpenText, label: 'EPUB 书籍' }
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg':
      return { kind: 'image', icon: FileImage, label: '图片附件' }
    default: return { kind: 'attachment', icon: Paperclip, label: '附件' }
  }
})
</script>

<template>
  <span class="file-type-icon" :data-file-kind="appearance.kind" :title="appearance.label" aria-hidden="true" :style="{ width: `${size + 8}px`, height: `${size + 10}px` }">
    <component :is="appearance.icon" :size="size" :stroke-width="1.7" />
  </span>
</template>

<style scoped>
.file-type-icon { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; border-radius: 5px; background: var(--file-icon-fill, #edf0f2); vertical-align: middle; }
.file-type-icon > svg { color: var(--file-icon-color, #65717b); }
[data-file-kind='folder'] { --file-icon-color: #936631; --file-icon-fill: #f5eddf; }
[data-file-kind='markdown'] { --file-icon-color: #8b5f47; --file-icon-fill: #f3e9e0; }
[data-file-kind='text'] { --file-icon-color: #65717b; --file-icon-fill: #edf0f2; }
[data-file-kind='pdf'] { --file-icon-color: #a25050; --file-icon-fill: #f7e9e7; }
[data-file-kind='word'] { --file-icon-color: #426a9b; --file-icon-fill: #e8eff8; }
[data-file-kind='excel'] { --file-icon-color: #477359; --file-icon-fill: #e6f0e8; }
[data-file-kind='book'] { --file-icon-color: #76618e; --file-icon-fill: #eee9f4; }
[data-file-kind='image'] { --file-icon-color: #8a6481; --file-icon-fill: #f2e9f0; }
</style>
