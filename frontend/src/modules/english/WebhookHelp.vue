<script setup lang="ts">
import { Button as AButton, Popover as APopover } from 'ant-design-vue'
import { BookOpen, CircleHelp, LibraryBig, MessageSquareText, Radio, X } from 'lucide-vue-next'
import { ref } from 'vue'

const opened = ref(false)
</script>

<template>
  <APopover v-model:open="opened" trigger="click" placement="bottomLeft" :destroy-tooltip-on-hide="true">
    <template #title>
      <div class="webhook-help-heading">
        <strong>内容从哪里来？</strong>
        <AButton type="text" aria-label="关闭来源说明" @click="opened = false">
          <X :size="16" aria-hidden="true" />
        </AButton>
      </div>
    </template>
    <template #content>
      <section class="webhook-help-body" aria-label="学习内容来源" tabindex="0">
        <dl class="source-guide">
          <div><dt><Radio :size="16" aria-hidden="true" /><strong>推送文章</strong></dt><dd>外部通过 Webhook 推送的文章和单词。</dd></div>
          <div><dt><BookOpen :size="16" aria-hidden="true" /><strong>阅读</strong></dt><dd>内置入门文章、手动添加，以及启用后同步的 NASA 科普文章。</dd></div>
          <div><dt><MessageSquareText :size="16" aria-hidden="true" /><strong>短句</strong></dt><dd>阅读材料中已整理的重点句，不自动拆分推送文章。</dd></div>
          <div><dt><LibraryBig :size="16" aria-hidden="true" /><strong>词库</strong></dt><dd>历次推送的单词，以及你自行导入的单词。</dd></div>
        </dl>
      </section>
    </template>
    <AButton type="text" size="small" class="webhook-help-trigger" aria-label="学习内容来源说明" :aria-expanded="opened">
      <CircleHelp :size="15" aria-hidden="true" />内容来源
    </AButton>
  </APopover>
</template>

<style scoped>
.webhook-help-trigger {
  font-size: 12px;
  color: var(--color-text-muted);
  min-height: 32px;
  white-space: nowrap;
  padding-inline: 6px;
}
.webhook-help-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.webhook-help-heading > strong { font-size: 15px; color: var(--color-text); }
.webhook-help-heading button { min-height: 36px; min-width: 36px; }
.webhook-help-body {
  width: 328px;
  max-width: calc(100vw - 56px);
  max-height: min(360px, calc(100dvh - 180px));
  overflow: auto;
  overscroll-behavior: contain;
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.source-guide { margin: 4px 0 0; }
.source-guide > div { padding: 12px 2px; }
.source-guide > div + div { border-top: 1px solid var(--color-border); }
.source-guide dt { display: flex; align-items: center; gap: 9px; color: var(--color-primary); }
.source-guide strong { color: var(--color-text); font-weight: 600; }
.source-guide dd { margin: 5px 0 0 25px; color: var(--color-text-muted); line-height: 1.7; }
@media (max-width: 600px) {
  .webhook-help-trigger { min-height: 44px; }
  .webhook-help-heading button { min-height: 44px; min-width: 44px; }
}
</style>
