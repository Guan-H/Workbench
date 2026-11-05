<script setup lang="ts">
import { Tree as ATree, Button as AButton } from 'ant-design-vue'

import { computed, ref } from 'vue'
import { ChevronRight, ChevronDown, Folder } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'
import { fileNodes } from './file-tree'

const props = withDefaults(defineProps<{ folders: Note[]; selected: string; query?: string }>(), { query: '' })
const emit = defineEmits<{ select: [path: string] }>()
const expanded = ref(new Set<string>())
const nodes = computed(() => fileNodes(props.folders.filter(item => item.path.includes(props.query)), '', !!props.query))
function toggle(id: string) { if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id) }
</script>
<template>
  <ATree :expanded-keys="[...expanded]" :tree-data="nodes" :selectable="false" block-node class="directory-tree" @expand="keys => expanded = new Set(keys.map(String))">
    <template #switcherIcon="{ dataRef: node }"><AButton type="text" class="icon-button" :aria-label="`展开目标目录：${node.item.path}`" :aria-expanded="expanded.has(node.key)" @click.stop="toggle(node.key)"><component :is="expanded.has(node.key) ? ChevronDown : ChevronRight" :size="15" /></AButton></template>
    <template #title="{ item: folder }"><AButton type="text" class="directory-choice" :class="{ active: selected === folder.path }" :aria-pressed="selected === folder.path" :aria-label="`选择目录：${folder.path}`" @click="emit('select', folder.path)"><Folder :size="17" aria-hidden="true" /><span>{{ query ? folder.path : folder.path.split('/').at(-1) }}</span></AButton></template>
  </ATree>
</template>
