<script setup lang="ts">
import { Modal as AModal } from 'ant-design-vue'

// Business dialogs own their explicit close/submit actions, including uncertain writes.
withDefaults(defineProps<{ label: string; wide?: boolean }>(), { wide: false })
</script>

<template>
  <AModal :open="true" :width="wide ? 900 : 500" :footer="null" :closable="false" :mask-closable="false" :keyboard="false" centered class="app-dialog">
    <template #title><span class="sr-only">{{ label }}</span></template>
    <slot />
  </AModal>
</template>
