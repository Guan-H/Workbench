<script setup lang="ts">
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
  <div class="modal-backdrop confirmation-backdrop"><section ref="panel" class="modal confirmation-dialog" role="alertdialog" aria-modal="true" :aria-label="props.title" @keydown="key"><header><h2>{{ title }}</h2></header><p class="confirmation-message">{{ message }}</p><footer><button @click="emit('answer', false)">取消</button><button class="primary" @click="emit('answer', true)">{{ confirmLabel }}</button></footer></section></div>
</template>
