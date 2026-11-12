<script setup lang="ts">
import { RadioGroup as ARadioGroup, RadioButton as ARadioButton } from 'ant-design-vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Article } from './types'
import ReadAloudButton from './ReadAloudButton.vue'
import { stopEnglishSpeech } from './speech'
const props = defineProps<{ article: Article }>()
const mode = ref<'original' | 'translation' | 'bilingual'>('original')
watch(mode, () => stopEnglishSpeech())
watch(() => props.article, () => stopEnglishSpeech())
onBeforeUnmount(() => stopEnglishSpeech())
</script>
<template>
  <article class="english-article">
    <div class="english-article-heading"><h3>{{ article.title }}</h3><ReadAloudButton :text="article.text" label="朗读文章或句子" /></div>
    <ARadioGroup v-model:value="mode" size="small" aria-label="文章阅读模式" class="article-mode"><ARadioButton value="original">原文</ARadioButton><ARadioButton value="translation">译文</ARadioButton><ARadioButton value="bilingual">双语对照</ARadioButton></ARadioGroup>
    <p v-if="mode === 'original'" lang="en">{{ article.text }}</p>
    <p v-else-if="mode === 'translation'">{{ article.translation || '这篇文章尚未提供译文。' }}</p>
    <ol v-else-if="article.sentences?.length" class="article-sentences" aria-label="逐句英中对照"><li v-for="(sentence,index) in article.sentences" :key="index"><div class="article-sentence-english"><p lang="en">{{ sentence.text }}</p><ReadAloudButton :text="sentence.text" :label="`朗读第 ${index+1} 句`" compact /></div><p class="article-sentence-translation">{{ sentence.translation }}</p></li></ol>
    <template v-else><p class="article-alignment-note" role="status">这篇历史文章没有逐句配对数据，下面是整篇原文和译文，不代表逐句对应。</p><p lang="en">{{ article.text }}</p><p class="article-sentence-translation">{{ article.translation || '尚未提供译文。' }}</p></template>
  </article>
</template>
<style scoped>
.article-mode{margin:0 0 12px}.english-article-heading{display:flex;justify-content:space-between;align-items:start;gap:12px}.english-article h3{margin:0 0 10px;font-size:16px}.english-article p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9}.article-sentences{list-style:none;margin:0;padding:0}.article-sentences li{padding:12px 0;border-bottom:1px solid var(--color-border)}.article-sentence-english{display:flex;align-items:start;gap:8px}.article-sentence-english p{margin:0;min-width:0;flex:1}.article-sentence-translation{color:var(--color-text-muted);margin:6px 0 0}.article-alignment-note{font-size:12px;color:var(--color-text-muted)}
</style>
