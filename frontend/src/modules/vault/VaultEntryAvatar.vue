<script setup lang="ts">
import { Avatar as AAvatar } from 'ant-design-vue'
import { computed } from 'vue'
import { entryIcons } from './entry-icons'
import type { EntryAvatar } from './entry-avatar'
import { entryIconDataUrl } from './entry-icon-assets'

const props = withDefaults(defineProps<{ name: string; icon?: EntryAvatar; size?: number }>(), { size: 38 })
const label = computed(() => typeof props.icon === 'object' ? '自定义头像' : props.icon ? (entryIcons.find(item => item.id === props.icon)?.label ?? '') + ' 头像' : '默认首字头像')
const source = computed(() => typeof props.icon === 'object' ? props.icon.dataUrl : props.icon ? entryIconDataUrl(props.icon) : undefined)
const letter = computed(() => Array.from(props.name)[0] ?? '私')
</script>

<template>
  <AAvatar shape="square" :size="size" :src="source" alt="" role="img" :aria-label="label" :title="label" class="vault-entry-avatar" :class="{ 'vault-platform-avatar': !!icon, 'vault-custom-avatar': typeof icon === 'object' }">{{ letter }}</AAvatar>
</template>

<style scoped>
.vault-platform-avatar.ant-avatar { background: var(--color-surface); border: 1px solid var(--color-border); }
.vault-platform-avatar :deep(img) { object-fit: contain; padding: 7px; }
.vault-custom-avatar :deep(img) { padding: 0; }
</style>
