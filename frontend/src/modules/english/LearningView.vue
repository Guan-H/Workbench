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
    <header><h1>学习</h1><p>阅读每日文章，复习历史词句，按自己的节奏练习。</p><ARadioGroup v-model:value="tab" aria-label="学习页面内容"><ARadioButton value="articles">文章与批次练习</ARadioButton><ARadioButton value="study">计划与个人词库</ARadioButton></ARadioGroup></header>
    <div class="learning-scroll" v-content-motion="tab"><DailyEnglishCard v-show="tab==='articles'" ref="articles" :username="username" @study="tab='study'" /><StudyDialog v-if="tab==='study'" embedded :username="username" @close="tab='articles'" @source="source" /></div>
  </section>
</template>
<style scoped>
.learning-page{display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}.learning-page>header{padding:20px 24px;border-bottom:1px solid var(--color-border)}.learning-page h1{margin:0 0 6px;font-size:24px}.learning-page>header p{font-size:13px;color:var(--color-text-muted);margin-bottom:16px}.learning-scroll{flex:1;min-height:0;overflow:auto;padding:20px 24px}.learning-scroll :deep(.english-scroll){max-height:min(52dvh,640px)}@media(max-width:600px){.learning-page>header,.learning-scroll{padding:16px}.learning-page>header :deep(.ant-radio-group){display:flex;flex-wrap:wrap;gap:6px}}
</style>
