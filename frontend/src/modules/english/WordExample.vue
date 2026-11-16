<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { ref, useId, watch } from 'vue'
import ReadAloudButton from './ReadAloudButton.vue'
const props = defineProps<{ word: string; example: string; translation?: string | null }>()
const expanded = ref(false)
const translationId = useId()
watch(() => [props.word, props.example, props.translation], () => { expanded.value = false })
</script>

<template>
  <div class="word-example">
    <div class="word-example-original"><p lang="en">{{ example }}</p><ReadAloudButton :text="example" :label="`朗读例句 ${word}`" compact /></div>
    <template v-if="translation?.trim()">
      <AButton type="link" size="small" :aria-expanded="expanded" :aria-controls="translationId" @click="expanded = !expanded">{{ expanded ? '收起例句译文' : '查看例句译文' }}</AButton>
      <p v-if="expanded" :id="translationId" class="word-example-translation" lang="zh-CN">{{ translation }}</p>
    </template>
    <span v-else class="word-example-missing">尚未提供例句译文</span>
  </div>
</template>

<style scoped>
.word-example-original{display:flex;align-items:start;gap:8px}.word-example-original p{margin:0;min-width:0;flex:1}.word-example p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9}.word-example .ant-btn{padding-inline:0;min-height:32px}.word-example-translation{margin:4px 0 0;padding:8px 12px;border-left:2px solid var(--color-border);color:var(--color-text-muted)}.word-example-missing{display:block;margin-top:4px;font-size:12px;color:var(--color-text-muted)}@media(max-width:600px){.word-example .ant-btn{min-height:44px}}
</style>
