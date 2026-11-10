<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{ load: () => Promise<Blob>; alt: string }>()
const source = ref(''), error = ref('')
let disposed = false
onMounted(async () => {
  try { const blob = await props.load(); if (!disposed) source.value = URL.createObjectURL(blob) }
  catch { if (!disposed) error.value = '此插图无法显示' }
})
onBeforeUnmount(() => { disposed = true; if (source.value) URL.revokeObjectURL(source.value) })
</script>
<template><figure class="reader-image"><img v-if="source" :src="source" :alt="alt"><figcaption v-else>{{ error || '正在加载插图…' }}</figcaption></figure></template>
<style scoped>.reader-image { margin: 1.5em 0; text-align: center; min-height: 100px; } img { max-width: 100%; height: auto; } figcaption { color: inherit; font-size: .8em; opacity: .7; }</style>
