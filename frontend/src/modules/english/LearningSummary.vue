<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue';
import { ArrowUpRight, BookOpen, Languages } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../shared/api/client';
import ContentLoading from '../../shared/ContentLoading.vue';
const emit = defineEmits<{
    open: [
    ];
}>();
const data = ref<{
    date: string;
    articles: number;
    words: number;
    latestTitle: string | null;
}>();
const error = ref(''), loading = ref(false);
const controller = new AbortController();
async function load() {
    loading.value = true;
    error.value = '';
    try {
        data.value = await api('/home/english/summary', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
    }
    catch (cause) {
        if (!controller.signal.aborted)
            error.value = cause instanceof Error ? cause.message : '学习摘要读取失败。';
    }
    finally {
        if (!controller.signal.aborted)
            loading.value = false;
    }
}
onMounted(load);
onBeforeUnmount(() => controller.abort());
</script>
<template>
  <section class="home-card learning-summary" aria-label="学习摘要" :aria-busy="loading">
    <header class="home-card-heading"><h2><BookOpen :size="17" aria-hidden="true" />每日学习</h2><span v-if="data"><time :datetime="data.date">{{ data.date.replaceAll('-', ' / ') }}</time></span></header>
    <ContentLoading v-if="loading&&!data" label="正在读取学习摘要…" />
    <div v-else-if="error" role="alert"><p>{{ error }}</p><AButton @click="load">重试</AButton></div>
    <template v-else-if="data">
      <p class="sr-only">{{ data.date }} · 今日 {{ data.articles }} 篇文章 · {{ data.words }} 个单词</p>
      <div class="learning-story"><div class="learning-story-copy"><span class="learning-eyebrow">{{ data.latestTitle ? '今日文章' : '今天，从一点积累开始' }}</span><h3 v-if="data.latestTitle" class="learning-title">{{ data.latestTitle }}</h3><h3 v-else class="learning-title">给英语留一点时间。</h3><p>阅读文章、复习单词，继续你的学习计划。</p></div><div class="learning-paper" aria-hidden="true"><BookOpen :size="40" /><span>English</span></div></div>
      <div class="learning-summary-bottom"><div class="learning-summary-counts" aria-label="今日学习内容"><span><BookOpen :size="14" aria-hidden="true" /><strong>{{ data.articles }}</strong> 篇文章</span><span><Languages :size="14" aria-hidden="true" /><strong>{{ data.words }}</strong> 个单词</span></div><AButton type="primary" @click="emit('open')">继续学习<ArrowUpRight :size="16" aria-hidden="true" /></AButton></div>
    </template>
  </section>
</template>
<style scoped>
.learning-summary { min-width: 0; padding: 24px; border-radius: 14px; background: var(--color-surface); box-shadow: 0 2px 8px var(--color-card-shadow); }
.home-card-heading { margin-bottom: 0; }
.home-card-heading h2 { font-size: 15px; gap: 8px; }
.home-card-heading h2 svg { color: var(--color-text-muted); }
.home-card-heading time { font-size: 11px; letter-spacing: 1px; }
.learning-story { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin: 20px 0; padding: 24px; border-radius: 10px; background: var(--color-paper-tint); }
.learning-story-copy { min-width: 0; }
.learning-eyebrow { color: var(--color-accent-warm); font-size: 11px; letter-spacing: 1px; }
.learning-title { margin: 10px 0; color: var(--color-text); font-family: Georgia, 'Songti SC', SimSun, serif; font-size: clamp(22px, 2vw, 28px); font-weight: 400; letter-spacing: -.3px; line-height: 1.5; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.learning-paper { display: grid; flex-shrink: 0; justify-items: center; align-content: center; gap: 10px; width: 104px; height: 124px; border: 1px solid var(--color-border); border-left: 6px solid #b4bfcf; border-radius: 4px 10px 10px 4px; background: var(--color-surface); color: var(--color-primary); box-shadow: 5px 5px 0 #d9d2c45c; transform: rotate(6deg); }
.learning-paper span { font-family: Georgia, serif; font-size: 14px; font-style: italic; }
.learning-summary p { margin: 0; line-height: 1.8; color: var(--color-text-muted); font-size: 12px; }
.learning-summary-bottom { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding-top: 0; }
.learning-summary-counts { display: flex; flex-wrap: wrap; gap: 16px; }
.learning-summary-counts > span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted); }
.learning-summary-counts strong { font-size: 18px; color: var(--color-text); font-weight: 550; font-variant-numeric: tabular-nums; }
.learning-summary-bottom .ant-btn { min-height: 40px; padding-inline: 16px; border-radius: 7px; box-shadow: none; font-size: 12px; }
@media (min-width: 901px) {
  .learning-summary { padding: 14px 18px; }
  .learning-story { gap: 16px; margin: 8px 0; padding: 10px 16px; }
  .learning-title { margin: 6px 0; font-size: clamp(19px, 1.6vw, 23px); line-height: 1.35; -webkit-line-clamp: 1; }
  .learning-paper { width: 68px; height: 74px; gap: 4px; border-left-width: 4px; box-shadow: 3px 3px 0 #d9d2c45c; }
  .learning-paper svg { width: 26px; height: 26px; }
  .learning-paper span { font-size: 12px; }
  .learning-summary-bottom { gap: 12px; }
  .learning-summary-counts { gap: 12px; }
  .learning-summary-counts strong { font-size: 16px; }
  .learning-summary-bottom .ant-btn { min-height: 36px; padding-inline: 14px; }
}
@media (max-width: 1120px) { .learning-paper { display: none; } }
@media (max-width: 480px) { .learning-summary { padding: 16px; } .learning-story { margin-block: 18px; padding: 20px 16px; } .learning-summary-counts { gap: 12px; } .learning-summary-bottom .ant-btn { min-height: 44px; } }
</style>
