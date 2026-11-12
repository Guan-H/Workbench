<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { Clock3, LoaderCircle, Square, Volume2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { englishSpeech, prepareEnglishSpeech, stopEnglishSpeech, toggleEnglishSpeech } from './speech'
import { speechOptions, type SpeechKind } from './speech-preferences'

const props = withDefaults(defineProps<{ text: string; label: string; compact?: boolean; disabled?: boolean; kind?: SpeechKind; once?: boolean }>(), { compact: false, disabled: false, kind: 'sentence', once: false })
const owner = Symbol('english-reader')
const current = computed(() => englishSpeech.value?.owner === owner ? englishSpeech.value : undefined)
const progress = computed(() => current.value ? `${current.value.phase === 'waiting' ? '跟读间隔 · 已读' : '第'} ${current.value.iteration} / ${current.value.total} 遍` : '')
const title = computed(() => current.value ? `停止${props.label} · ${progress.value}` : props.label)
onMounted(prepareEnglishSpeech)
watch([() => props.text, () => props.kind], () => stopEnglishSpeech(owner))
watch(() => props.disabled, value => { if (value) stopEnglishSpeech(owner) })
onBeforeUnmount(() => stopEnglishSpeech(owner))
</script>

<template>
  <span class="speech-control">
  <AButton type="text" class="speech-button" :class="{ 'speech-button-active': current, 'speech-button-compact': compact }" :title="title" :aria-label="title" :aria-pressed="!!current" :disabled="disabled || !text.trim()" @click.stop="toggleEnglishSpeech(owner, text, once ? { repeats: 1, gapSeconds: 2 } : speechOptions(kind))">
    <LoaderCircle v-if="current?.phase === 'starting'" class="speech-loading" :size="16" aria-hidden="true" /><Clock3 v-else-if="current?.phase === 'waiting'" :size="16" aria-hidden="true" /><Square v-else-if="current" :size="15" aria-hidden="true" /><Volume2 v-else :size="16" aria-hidden="true" />
    <span v-if="!compact">{{ current ? '停止' : '朗读' }}</span>
  </AButton>
  <small v-if="current && current.total > 1" class="speech-repeat-progress" role="status" :aria-label="progress" :title="progress">{{ compact ? `${current.iteration}/${current.total}` : progress }}</small>
  </span>
</template>

<style scoped>
.speech-control{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;flex-wrap:wrap;max-width:100%}.speech-repeat-progress{font-size:12px;color:var(--color-primary);line-height:1.5}
.speech-button.ant-btn { flex-shrink: 0; min-height: 32px; color: var(--color-text-muted); padding: 4px 8px; font-size: 12px; }
.speech-button-compact.ant-btn { width: 32px; padding: 4px; }
.speech-button-active.ant-btn { color: var(--color-primary); background: var(--color-selection); }
.speech-loading { animation: speech-spin 1s linear infinite; }
@keyframes speech-spin { to { transform: rotate(360deg); } }
@media (pointer: coarse), (max-width: 600px) { .speech-button.ant-btn { min-height: 44px; min-width: 44px; } }
@media (prefers-reduced-motion: reduce) { .speech-loading { animation: none; } }
</style>
