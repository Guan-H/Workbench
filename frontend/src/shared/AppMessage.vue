<script setup lang="ts">
import { h, onBeforeUnmount, watch } from 'vue'
import { Button as AButton, message } from 'ant-design-vue'
import { X } from 'lucide-vue-next'

export interface Notice { kind: 'saving' | 'success' | 'error' | 'info'; text: string }
const props = defineProps<{ notice?: Notice; testId?: string }>()
const emit = defineEmits<{ close: [] }>()
const [api, ContextHolder] = message.useMessage()
// The owner controls lifetime, so repeated saves replace one message without stacking.
watch(() => props.notice, notice => {
  if (!notice) { api.destroy('feedback'); return }
  const content = h('span', { class: 'app-message-content' }, [
    h('span', { 'data-testid': props.testId, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text),
    h(AButton, { type: 'text', size: 'small', title: '关闭消息', 'aria-label': '关闭消息', onClick: () => emit('close') },
      () => h(X, { size: 14, 'aria-hidden': 'true' })),
  ])
  api.open({ key: 'feedback', type: notice.kind === 'saving' ? 'loading' : notice.kind, duration: 0, content })
}, { flush: 'post' })
onBeforeUnmount(() => api.destroy())
</script>

<template><ContextHolder /></template>
