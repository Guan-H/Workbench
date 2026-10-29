<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, ChevronDown, Folder } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'

const props = withDefaults(defineProps<{ folders: Note[]; selected: string; parent?: string; depth?: number; query?: string }>(), { parent: '', depth: 0, query: '' })
const emit = defineEmits<{ select: [path: string] }>()
const expanded = ref(new Set<string>())
const visible = computed(() => props.folders.filter(item => props.query ? item.path.includes(props.query) : item.path.split('/').slice(0, -1).join('/') === props.parent).sort((a,b) => a.path.localeCompare(b.path, 'zh-CN')))
function toggle(id: string) { if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id) }
</script>
<template>
  <ul class="directory-tree">
    <li v-for="folder in visible" :key="folder.id">
      <div class="directory-tree-row" :style="{ paddingLeft: `${depth * 16}px` }">
        <button v-if="!query" class="icon-button" :aria-label="`展开目标目录：${folder.path}`" :aria-expanded="expanded.has(folder.id)" @click="toggle(folder.id)"><component :is="expanded.has(folder.id) ? ChevronDown : ChevronRight" :size="15" /></button>
        <button class="directory-choice" :class="{ active: selected === folder.path }" :aria-pressed="selected === folder.path" :aria-label="`选择目录：${folder.path}`" @click="emit('select', folder.path)"><Folder :size="17" aria-hidden="true" /><span>{{ query ? folder.path : folder.path.split('/').at(-1) }}</span></button>
      </div>
      <DirectoryTree v-if="!query && expanded.has(folder.id)" :folders="folders" :selected="selected" :parent="folder.path" :depth="depth + 1" @select="emit('select', $event)" />
    </li>
  </ul>
</template>
