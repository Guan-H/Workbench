<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue';
defineProps<{
    error?: Error;
}>();
function reload() { window.location.reload(); }
</script>

<template>
  <section class="content-load-error" role="alert">
    <p>页面资源加载失败，请检查网络后重新加载。</p>
    <AButton @click="reload">重新加载页面</AButton>
  </section>
</template>

<style scoped>
.content-load-error{padding:24px;color:var(--color-text-muted)}
</style>
