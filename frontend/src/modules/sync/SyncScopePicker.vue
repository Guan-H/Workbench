<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'
export interface SyncScope { all: boolean; folders: string[] }
const props = defineProps<{ modelValue: SyncScope; items: Note[]; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [scope: SyncScope] }>()
const query = ref('')
const page = ref(0)
const folders = computed(() => props.items.filter(item => item.type === 'folder' && !item.deleted && item.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())).sort((a, b) => a.path.localeCompare(b.path, 'zh-CN')))
const pages = computed(() => Math.max(1, Math.ceil(folders.value.length / 20)))
const rows = computed(() => folders.value.slice(page.value * 20, (page.value + 1) * 20))
watch(query, () => { page.value = 0 })
watch(pages, value => { page.value = Math.min(page.value, value - 1) })
function covered(path: string) { return props.modelValue.folders.some(root => path === root || path.startsWith(root + '/')) }
function inherited(path: string) { return props.modelValue.folders.some(root => path !== root && path.startsWith(root + '/')) }
function toggle(path: string) {
  const current = props.modelValue.folders
  emit('update:modelValue', { all: false, folders: current.includes(path) ? current.filter(root => root !== path)
    : [...current.filter(root => !root.startsWith(path + '/')), path] })
}
</script>
<template>
  <fieldset class="sync-scope-picker" :disabled="disabled">
    <legend>同步范围</legend>
    <div class="sync-scope-modes"><label><input type="radio" :checked="modelValue.all" @change="emit('update:modelValue', { all: true, folders: [] })" />全部同步</label><label><input type="radio" :checked="!modelValue.all" @change="emit('update:modelValue', { all: false, folders: [] })" />选择文件夹</label></div>
    <template v-if="!modelValue.all">
      <input v-model="query" aria-label="搜索同步目录" placeholder="搜索目录路径" type="search" />
      <div class="sync-scope-folders" tabindex="0" aria-label="可选同步目录">
        <label v-for="folder in rows" :key="folder.id" :title="inherited(folder.path) ? '已包含在选中的父目录内，先取消父目录再单选' : folder.path"><input type="checkbox" :aria-label="'同步目录：' + folder.path" :checked="covered(folder.path)" :disabled="disabled || inherited(folder.path)" @change="toggle(folder.path)" /><Folder :size="15" aria-hidden="true" /><span>{{ folder.path }}</span></label>
        <p v-if="!rows.length">没有匹配的文件夹。</p>
      </div>
      <nav class="sync-pagination" aria-label="同步目录分页"><button type="button" :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ pages }} 页 · 已选 {{ modelValue.folders.length }} 个目录</span><button type="button" :disabled="page + 1 >= pages" @click="page++">下一页</button></nav>
      <p v-if="!modelValue.folders.length" class="field-help">至少选择一个目录，包含其全部子目录。</p>
      <p v-else class="field-help">已选：{{ modelValue.folders.join('、') }}</p>
    </template>
    <p class="field-help">保留库内路径，自动纳入标准 Markdown 引用的库内附件。目录外附件本地缺失会重新下载，不反向删除共享附件；未选内容不参与同步。</p>
  </fieldset>
</template>
