<script setup lang="ts">
import { RadioGroup as ARadioGroup, RadioButton as ARadioButton } from 'ant-design-vue';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import DailyEnglishCard from './DailyEnglishCard.vue';
import StudyDialog from './StudyDialog.vue';
import { stopEnglishSpeech } from './speech';
import type { StudySource } from './study-types';
import { vContentMotion } from '../../shared/content-motion';
defineProps<{
    username: string;
}>();
const tab = ref('articles'), articles = ref<{
    openStudySource: (source: StudySource) => Promise<void>;
}>();
async function source(value: StudySource) { tab.value = 'articles'; await nextTick(); await articles.value?.openStudySource(value); }
watch(tab, () => stopEnglishSpeech());
onBeforeUnmount(() => stopEnglishSpeech());
</script>
<template>
  <section class="learning-page" aria-label="学习页面">
    <header><span class="learning-page-kicker">阅读与积累</span><h1>学习</h1><p>阅读每日文章，复习历史词句，按自己的节奏练习。</p><ARadioGroup v-model:value="tab" aria-label="学习页面内容"><ARadioButton value="articles">文章与批次练习</ARadioButton><ARadioButton value="study">计划与个人词库</ARadioButton></ARadioGroup></header>
    <div class="learning-scroll" v-content-motion="tab"><DailyEnglishCard v-show="tab==='articles'" ref="articles" :username="username" @study="tab='study'" /><StudyDialog v-if="tab==='study'" embedded :username="username" @close="tab='articles'" @source="source" /></div>
  </section>
</template>
<style scoped>
.learning-page { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; background: var(--color-background); }
.learning-page > header { padding: 28px 32px 20px; }
.learning-page-kicker { color: var(--color-accent-warm); font-size: 11px; letter-spacing: 1.5px; }
.learning-page h1 { margin: 8px 0; font-family: Georgia, 'Songti SC', SimSun, serif; font-size: 36px; font-weight: 400; }
.learning-page > header p { font-size: 13px; color: var(--color-text-muted); margin: 0 0 20px; }
.learning-page > header :deep(.ant-radio-group) { display: inline-flex; padding: 4px; border: 1px solid var(--color-border); border-radius: 10px; background: #eeede8; }
.learning-page > header :deep(.ant-radio-button-wrapper) { height: auto; line-height: 1.6; padding: 8px 14px; border: 0; border-radius: 7px; background: transparent; color: var(--color-text-muted); font-size: 12px; }
.learning-page > header :deep(.ant-radio-button-wrapper::before) { display: none; }
.learning-page > header :deep(.ant-radio-button-wrapper-checked) { background: var(--color-surface); color: var(--color-text); box-shadow: 0 1px 4px var(--color-card-shadow); }
.learning-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 32px 32px; }
.learning-scroll :deep(.daily-english) { padding: 26px; border-radius: 14px; box-shadow: 0 2px 8px var(--color-card-shadow); }
.learning-scroll :deep(.english-history) { border-bottom: 1px solid var(--color-border); padding-bottom: 12px; margin-bottom: 20px; }
.learning-scroll :deep(.english-history > summary) { padding: 8px 0; }
.learning-scroll :deep(.english-scroll) { max-height: min(52dvh, 640px); padding-right: 12px; scrollbar-gutter: stable; }
.learning-scroll :deep(.english-article h3) { font-family: Georgia, 'Songti SC', SimSun, serif; font-size: 26px; line-height: 1.5; font-weight: 400; margin-bottom: 18px; }
.learning-scroll :deep(.english-article p[lang='en']) { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; line-height: 1.95; }
.learning-scroll :deep(.english-words) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.learning-scroll :deep(.english-words li) { padding: 18px; border: 1px solid var(--color-border); border-radius: 10px; background: #faf9f6; }
.learning-scroll :deep(.english-words li > div) { gap: 8px; }
.learning-scroll :deep(.english-words strong) { font-family: Georgia, serif; font-weight: 400; font-size: 23px; }
.learning-scroll :deep(.study-embedded) { padding: 0 24px 20px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; }
@media (max-width: 1100px) { .learning-scroll :deep(.english-words) { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) {
  .learning-page > header { padding: 24px 16px 20px; }
  .learning-scroll { padding: 0 16px 24px; }
  .learning-page > header :deep(.ant-radio-group) { display: flex; flex-wrap: wrap; gap: 6px; }
  .learning-page > header :deep(.ant-radio-button-wrapper) { min-height: 44px; display: inline-flex; align-items: center; padding-inline: 10px; }
  .learning-scroll :deep(.daily-english) { padding: 18px; }
  .learning-scroll :deep(.study-embedded) { padding: 0 16px 16px; }
}
</style>
