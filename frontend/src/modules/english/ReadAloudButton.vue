<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { LoaderCircle, Square, Volume2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { englishSpeech, prepareEnglishSpeech, stopEnglishSpeech, toggleEnglishSpeech } from './speech'

const props = withDefaults(defineProps<{ text: string; label: string; compact?: boolean; disabled?: boolean }>(), { compact: false, disabled: false })
const owner = Symbol('english-reader')
const current = computed(() => englishSpeech.value?.owner === owner ? englishSpeech.value : undefined)
const title = computed(() => current.value ? `停止${props.label}` : props.label)
onMounted(prepareEnglishSpeech)
watch(() => props.text, () => stopEnglishSpeech(owner))
onBeforeUnmount(() => stopEnglishSpeech(owner))
</script>

<template>
  <AButton type="text" class="speech-button" :class="{ 'speech-button-active': current, 'speech-button-compact': compact }" :title="title" :aria-label="title" :aria-pressed="!!current" :disabled="disabled || !text.trim()" @click.stop="toggleEnglishSpeech(owner, text)">
    <LoaderCircle v-if="current?.phase === 'starting'" class="speech-loading" :size="16" aria-hidden="true" /><Square v-else-if="current" :size="15" aria-hidden="true" /><Volume2 v-else :size="16" aria-hidden="true" />
    <span v-if="!compact">{{ current ? '停止' : '朗读' }}</span>
  </AButton>
</template>

<style scoped>
.speech-button.ant-btn { flex-shrink: 0; min-height: 32px; color: var(--color-text-muted); padding: 4px 8px; font-size: 12px; }
.speech-button-compact.ant-btn { width: 32px; padding: 4px; }
.speech-button-active.ant-btn { color: var(--color-primary); background: var(--color-selection); }
.speech-loading { animation: speech-spin 1s linear infinite; }
@keyframes speech-spin { to { transform: rotate(360deg); } }
@media (pointer: coarse), (max-width: 600px) { .speech-button.ant-btn { min-height: 44px; min-width: 44px; } }
@media (prefers-reduced-motion: reduce) { .speech-loading { animation: none; } }
</style>
