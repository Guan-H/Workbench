<script setup lang="ts">
import { Bot } from 'lucide-vue-next'
import { computed } from 'vue'
import deepseek from './provider-icons/deepseek.svg'
import kimi from './provider-icons/kimi.svg'
import openai from './provider-icons/openai.svg'
import openrouter from './provider-icons/openrouter.svg'
import siliconflow from './provider-icons/siliconflow.svg'

const props = defineProps<{ providerId: string }>()
const icons = new Map(Object.entries({ deepseek, kimi, openai, openrouter, siliconflow }))
const source = computed(() => icons.get(props.providerId))
</script>

<template>
  <span class="ai-provider-icon" aria-hidden="true">
    <img v-if="source" :src="source" alt="" />
    <Bot v-else />
  </span>
</template>

<style scoped>
.ai-provider-icon {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: var(--ai-provider-icon-size, 22px);
  height: var(--ai-provider-icon-size, 22px);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: white;
  color: #404754;
}
.ai-provider-icon :is(img, svg) { display: block; width: 70%; height: 70%; object-fit: contain; }
</style>
