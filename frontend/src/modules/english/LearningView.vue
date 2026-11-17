<script setup lang="ts">
import { Button as AButton, RadioGroup as ARadioGroup, RadioButton as ARadioButton } from 'ant-design-vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import DailyEnglishCard from './DailyEnglishCard.vue';
import StudyDialog from './StudyDialog.vue';
import CourseLearning from './CourseLearning.vue';
import { stopEnglishSpeech } from './speech';
import type { StudySource } from './study-types';
import { vContentMotion } from '../../shared/content-motion';
import WebhookHelp from './WebhookHelp.vue';
defineProps<{
    username: string;
}>();
const tab = ref('articles'), articlesVisited = ref(true), articles = ref<{
    openStudySource: (source: StudySource) => Promise<void>;
}>();
async function source(value: StudySource) { tab.value = 'articles'; await nextTick(); await articles.value?.openStudySource(value); }
const readingSection = computed(() => tab.value === 'sentences' ? 'sentences' : tab.value === 'collection' ? 'collection' : 'reading');
watch(tab, value => { stopEnglishSpeech(); if (value === 'articles') articlesVisited.value = true; });
onBeforeUnmount(() => stopEnglishSpeech());
</script>
<template>
  <section class="learning-page" aria-label="学习页面">
    <header><div class="learning-intro"><h1>学习</h1><p>读一篇文章，弄懂一句话。</p><WebhookHelp /></div><div class="learning-navigation"><ARadioGroup v-model:value="tab" aria-label="学习页面内容"><ARadioButton value="articles">推送文章</ARadioButton><ARadioButton value="reading">阅读</ARadioButton><ARadioButton value="sentences">短句</ARadioButton><ARadioButton value="collection">我的积累</ARadioButton></ARadioGroup><div><AButton :type="tab==='study'?'primary':'text'" @click="tab='study'">词库与计划</AButton></div></div></header>
    <div class="learning-scroll" v-content-motion="tab"><CourseLearning v-if="['reading','sentences','collection'].includes(tab)" :key="tab" :section="readingSection" :username="username" /><DailyEnglishCard v-if="articlesVisited" v-show="tab==='articles'" ref="articles" :username="username" /><StudyDialog v-if="tab==='study'" embedded :username="username" @close="tab='articles'" @source="source" /></div>
  </section>
</template>
<style scoped>
.learning-navigation{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.learning-navigation>div{display:flex;gap:8px;flex-wrap:wrap}
.learning-page { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; background: var(--color-background); }
.learning-page > header { padding: 14px 32px 12px; display:flex;align-items:center;justify-content:space-between;gap:12px 24px;flex-wrap:wrap; }
.learning-intro{display:flex;align-items:baseline;gap:14px}
.learning-page-kicker { color: var(--color-accent-warm); font-size: 11px; letter-spacing: 1.5px; }
.learning-page h1 { margin: 0; font-family: Georgia, 'Songti SC', SimSun, serif; font-size: 26px; font-weight: 400; }
.learning-page > header p { font-size: 13px; color: var(--color-text-muted); margin: 0; }
.learning-page > header :deep(.ant-radio-group) { display: inline-flex; padding: 4px; border: 1px solid var(--color-border); border-radius: 10px; background: #eeede8; }
.learning-page > header :deep(.ant-radio-button-wrapper) { height: auto; line-height: 1.6; padding: 8px 14px; border: 0; border-radius: 7px; background: transparent; color: var(--color-text-muted); font-size: 12px; }
.learning-page > header :deep(.ant-radio-button-wrapper::before) { display: none; }
.learning-page > header :deep(.ant-radio-button-wrapper-checked) { background: var(--color-surface); color: var(--color-text); box-shadow: 0 1px 4px var(--color-card-shadow); }
.learning-scroll { display:flex; flex-direction:column; flex: 1; min-height: 0; overflow: hidden; padding: 0 32px 24px; }
.learning-page > header { flex-shrink:0; }
.learning-scroll :deep(.daily-english) { padding: 16px 20px; border-radius: 14px; box-shadow: 0 2px 8px var(--color-card-shadow); }


.learning-scroll :deep(.english-scroll) { max-height: none; padding-right: 8px; scrollbar-gutter: stable; }
.learning-scroll :deep(.english-article h3) { font-family: Georgia, 'Songti SC', SimSun, serif; font-size: 22px; line-height: 1.5; font-weight: 400; margin-bottom: 8px; }
.learning-scroll :deep(.english-article p[lang='en']) { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; line-height: 1.95; }
.learning-scroll :deep(.english-words) { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-content:start; }
.learning-scroll :deep(.english-words li) { min-width:0; min-height:220px; padding: 16px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); }
.learning-scroll :deep(.english-words li > div) { gap: 8px; }
.learning-scroll :deep(.english-words strong) { font-family: Georgia, serif; font-weight: 400; font-size: 23px; }
.learning-scroll :deep(.study-embedded) { padding: 0 20px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; }
@media (min-width:1600px) { .learning-scroll :deep(.english-words) { grid-template-columns:repeat(5,minmax(0,1fr)); } }
@media (max-width:1350px) { .learning-scroll :deep(.english-words) { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:900px) { .learning-scroll :deep(.english-words) { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width: 600px) {
  .learning-page > header { padding: 10px 16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 8px; }
  .learning-navigation{display:contents}.learning-navigation>.ant-radio-group{grid-column:1/-1;grid-row:2}.learning-navigation>div{grid-column:2;grid-row:1}.learning-intro p{display:none}
  .learning-page h1 { font-size:22px; margin:0; }

  .learning-scroll :deep(.english-article h3){font-size:20px;margin-bottom:6px}
  .learning-scroll { padding: 0 12px 16px; }
  .learning-page > header :deep(.ant-radio-group) { display: flex; flex-wrap: wrap; gap: 6px; }
  .learning-page > header :deep(.ant-radio-button-wrapper) { min-height: 44px; display: inline-flex; align-items: center; padding-inline: 10px; }
  .learning-scroll :deep(.daily-english) { padding: 12px; }
  .learning-scroll :deep(.study-embedded) { padding: 0 12px; }
  .learning-scroll :deep(.english-words li) { min-height:180px; padding:10px; }
  .learning-scroll :deep(.english-words strong) { font-size:18px; }
}
</style>
