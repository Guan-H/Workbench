<script setup lang="ts">
import { computed } from 'vue'
import type { UploadProgress } from './api/client'
const props = defineProps<{ progress: UploadProgress; label: string }>()
const percent = computed(() => props.progress.total ? Math.min(100, Math.floor(props.progress.loaded / props.progress.total * 100)) : null)
function size(value: number) { return (value / 1048576).toFixed(1) + ' MiB' }
</script>
<template><div class="upload-progress"><div role="status" aria-live="polite">{{ label }} · {{ progress.transferred ? '传输完成，等待服务器处理' : percent === null ? '准备上传…' : `总上传进度 ${percent}%` }}<small v-if="progress.total !== null">{{ size(progress.loaded) }} / {{ size(progress.total) }}</small></div><progress aria-label="总上传进度" :value="percent ?? undefined" max="100" /></div></template>
