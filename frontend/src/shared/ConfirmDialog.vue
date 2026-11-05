<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import AppDialog from './AppDialog.vue'

import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
const props = withDefaults(defineProps<{ message: string; title?: string; confirmLabel?: string }>(), { title: '确认操作', confirmLabel: '确认' })
const emit = defineEmits<{ answer: [accepted: boolean] }>()
const panel = ref<HTMLElement>()
const previous = document.activeElement as HTMLElement
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') emit('answer', false)
  if (event.key === 'Tab') {
    const buttons = [...panel.value!.querySelectorAll('button')]
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
  }
}
onMounted(async () => { await nextTick(); panel.value?.querySelector('button')?.focus() })
onBeforeUnmount(() => { if (previous?.isConnected) previous.focus() })
</script>
<template>
  <AppDialog :label="props.title"><section ref="panel" class="modal confirmation-dialog"    @keydown="key"><header><h2>{{ title }}</h2></header><p class="confirmation-message">{{ message }}</p><footer><AButton @click="emit('answer', false)">取消</AButton><AButton type="primary" class="primary" @click="emit('answer', true)">{{ confirmLabel }}</AButton></footer></section></AppDialog>
</template>
