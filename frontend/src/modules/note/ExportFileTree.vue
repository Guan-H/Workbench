<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, ChevronDown, Folder, FileText } from 'lucide-vue-next'
import type { TreeItem } from '../../shared/api/client'
const props = withDefaults(defineProps<{ items: TreeItem[]; selected: string[]; parent?: string; depth?: number; disabled: boolean; flat?: boolean; query?: string }>(), { parent: '', depth: 0, flat: false, query: '' })
const emit = defineEmits<{ toggle: [item: TreeItem] }>()
const expanded = ref(new Set<string>())
const page = ref(1)
const children = computed(() => props.items.filter(item => props.flat ? item.path.includes(props.query) : item.path.split('/').slice(0, -1).join('/') === props.parent).sort((a,b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.path.localeCompare(b.path, 'zh-CN')))
const pages = computed(() => Math.max(1, Math.ceil(children.value.length / 30)))
const visible = computed(() => children.value.slice((page.value - 1) * 30, page.value * 30))
watch(() => props.query, () => { page.value = 1 })
watch(children, () => { page.value = Math.min(page.value, pages.value) })
function branch(item: TreeItem) { return props.items.filter(row => row.id === item.id || item.type === 'folder' && row.path.startsWith(item.path + '/')) }
function checked(item: TreeItem) { return branch(item).every(row => props.selected.includes(row.id)) }
function partial(item: TreeItem) { return !checked(item) && branch(item).some(row => props.selected.includes(row.id)) }
function expand(id: string) { if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id) }
</script>
<template><ul class="export-tree"><li v-for="item in visible" :key="item.id"><div class="export-tree-row" :style="{ paddingLeft: `${depth * 16}px` }"><button v-if="item.type === 'folder' && !flat" class="icon-button" :aria-label="`${expanded.has(item.id) ? '收起' : '展开'}目录：${item.path}`" :aria-expanded="expanded.has(item.id)" :disabled="disabled" @click="expand(item.id)"><component :is="expanded.has(item.id) ? ChevronDown : ChevronRight" :size="16" /></button><span v-else class="export-tree-indent" /><label class="export-choice"><input type="checkbox" :aria-label="`${item.type === 'folder' ? '目录：' : ''}${item.path}`" :checked="checked(item)" :indeterminate="partial(item)" :disabled="disabled" @change="emit('toggle', item)" /><component :is="item.type === 'folder' ? Folder : FileText" :size="16" aria-hidden="true" /><span>{{ item.type === 'folder' ? '目录：' : '' }}{{ flat ? item.path : item.path.split('/').at(-1) }}</span></label></div><ExportFileTree v-if="item.type === 'folder' && expanded.has(item.id) && !flat" :items="items" :selected="selected" :parent="item.path" :depth="depth + 1" :disabled="disabled" @toggle="emit('toggle', $event)" /></li><li v-if="pages > 1"><nav class="pagination" :aria-label="`${parent || '根目录'}导出列表分页`"><button :disabled="disabled || page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }}</span><button :disabled="disabled || page >= pages" @click="page++">下一页</button></nav></li></ul></template>
