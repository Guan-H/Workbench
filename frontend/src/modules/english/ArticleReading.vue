<script setup lang="ts">
import { RadioGroup as ARadioGroup, RadioButton as ARadioButton } from 'ant-design-vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Article } from './types'
import ReadAloudButton from './ReadAloudButton.vue'
import { stopEnglishSpeech } from './speech'
const props = defineProps<{ article: Article; fixedHeader?: boolean }>()
const readingBody = ref<HTMLElement>()
const originalBody = ref<HTMLElement>(), translatedBody = ref<HTMLElement>()
const mode = ref<'original' | 'translation' | 'bilingual' | 'full-bilingual'>('original')
watch(mode, () => stopEnglishSpeech())
watch(() => props.article, () => stopEnglishSpeech())
watch(() => props.article, () => { for (const body of [readingBody.value, originalBody.value, translatedBody.value]) if (body) body.scrollTop = 0 }, { flush: 'post' })
onBeforeUnmount(() => stopEnglishSpeech())
</script>
<template>
  <article class="english-article" :class="{ 'english-article-fixed': fixedHeader }">
    <header class="article-header">
    <div class="english-article-heading"><h3>{{ article.title }}</h3><ReadAloudButton :text="article.text" label="朗读文章或句子" kind="article" /></div>
    <ARadioGroup v-model:value="mode" size="small" aria-label="文章阅读模式" class="article-mode"><ARadioButton value="original">原文</ARadioButton><ARadioButton value="translation">译文</ARadioButton><ARadioButton value="bilingual">逐句对照</ARadioButton><ARadioButton value="full-bilingual">全文对照</ARadioButton></ARadioGroup>
    </header>
    <div ref="readingBody" class="article-body" :class="{'article-body-columns':fixedHeader&&mode==='full-bilingual'}" :role="fixedHeader ? 'region' : undefined" :aria-label="fixedHeader ? '文章正文' : undefined" :tabindex="fixedHeader ? 0 : undefined">
    <p v-if="mode === 'original'" lang="en">{{ article.text }}</p>
    <p v-else-if="mode === 'translation'">{{ article.translation || '这篇文章尚未提供译文。' }}</p>
    <div v-else-if="mode === 'full-bilingual'" class="article-full-bilingual" aria-label="全文英中对照"><section aria-label="全文原文"><h4>原文</h4><p ref="originalBody" lang="en" :tabindex="fixedHeader?0:undefined" aria-label="原文正文">{{ article.text }}</p></section><section aria-label="全文译文"><h4>译文</h4><p ref="translatedBody" lang="zh-CN" :tabindex="fixedHeader?0:undefined" aria-label="译文正文">{{ article.translation || '这篇文章尚未提供译文。' }}</p></section></div>
    <ol v-else-if="article.sentences?.length" class="article-sentences" aria-label="逐句英中对照"><li v-for="(sentence,index) in article.sentences" :key="index"><div class="article-sentence-english"><p lang="en">{{ sentence.text }}</p><ReadAloudButton :text="sentence.text" :label="`朗读第 ${index+1} 句`" compact /></div><p class="article-sentence-translation">{{ sentence.translation }}</p></li></ol>
    <template v-else><p class="article-alignment-note" role="status">这篇历史文章没有逐句配对数据，下面是整篇原文和译文，不代表逐句对应。</p><p lang="en">{{ article.text }}</p><p class="article-sentence-translation">{{ article.translation || '尚未提供译文。' }}</p></template>
    </div>
  </article>
</template>
<style scoped>
@media(min-width:601px){.english-article-fixed>.article-body.article-body-columns{display:flex;overflow:hidden;scrollbar-gutter:auto;padding-right:0}.article-body-columns>.article-full-bilingual{flex:1;min-height:0;overflow:hidden;grid-template-rows:minmax(0,1fr)}.article-body-columns>.article-full-bilingual>section{display:flex;flex-direction:column;min-height:0;overflow:hidden}.article-body-columns h4{flex-shrink:0}.article-body-columns p{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding-right:8px}}
.english-article-fixed{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden}.english-article-fixed>.article-header{flex-shrink:0}.english-article-fixed>.article-body{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding-right:8px}.article-header h3{min-width:0;overflow-wrap:anywhere}
.article-full-bilingual{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.article-full-bilingual section{min-width:0}.article-full-bilingual h4{margin:0;color:var(--color-text-muted);font-size:13px}.article-full-bilingual p{margin:8px 0 0}.article-full-bilingual section+section{padding-left:24px;border-left:1px solid var(--color-border)}.article-mode{display:flex;flex-wrap:wrap;row-gap:8px}@media(max-width:600px){.article-full-bilingual{grid-template-columns:minmax(0,1fr);gap:16px}.article-full-bilingual section+section{padding:16px 0 0;border-left:0;border-top:1px solid var(--color-border)}.article-mode :deep(.ant-radio-button-wrapper){height:auto;min-height:40px;display:inline-flex;align-items:center}}
.article-mode{margin:0 0 12px}.english-article-heading{display:flex;justify-content:space-between;align-items:start;gap:12px}.english-article h3{margin:0 0 10px;font-size:16px}.english-article p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9}.article-sentences{list-style:none;margin:0;padding:0}.article-sentences li{padding:12px 0;border-bottom:1px solid var(--color-border)}.article-sentence-english{display:flex;align-items:start;gap:8px}.article-sentence-english p{margin:0;min-width:0;flex:1}.article-sentence-translation{color:var(--color-text-muted);margin:6px 0 0}.article-alignment-note{font-size:12px;color:var(--color-text-muted)}
</style>
