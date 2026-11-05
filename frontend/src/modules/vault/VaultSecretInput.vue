<script setup lang="ts">
import { Button as AButton, Input as AInput, Tooltip as ATooltip } from 'ant-design-vue'
import { Copy, Eye, EyeOff } from 'lucide-vue-next'

const value = defineModel<string>({ required: true })
defineProps<{ id: string; visible: boolean; disabled?: boolean; readonly?: boolean; maxlength?: number; showLabel: string; hideLabel: string; copyLabel: string }>()
const emit = defineEmits<{ reveal: []; copy: [] }>()
</script>

<template>
  <AInput :id="id" v-model:value="value" :type="visible ? 'text' : 'password'" :readonly="readonly" :disabled="disabled" :maxlength="maxlength" autocomplete="off" class="vault-secret-input">
    <template #suffix>
      <ATooltip :title="visible ? hideLabel : showLabel"><AButton type="text" size="small" class="vault-input-action" :aria-label="visible ? hideLabel : showLabel" :disabled="disabled" @click="emit('reveal')"><EyeOff v-if="visible" :size="16" aria-hidden="true" /><Eye v-else :size="16" aria-hidden="true" /></AButton></ATooltip>
      <ATooltip :title="copyLabel"><AButton type="text" size="small" class="vault-input-action" :aria-label="copyLabel" :disabled="disabled || !value" @click="emit('copy')"><Copy :size="15" aria-hidden="true" /></AButton></ATooltip>
    </template>
  </AInput>
</template>
