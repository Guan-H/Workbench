<script setup lang="ts">
const initializationStatus = '工程骨架已启动，业务功能将在分阶段验收后开放。'
</script>

<template>
  <main class="startup-page">
    <section class="startup-panel" aria-labelledby="page-title">
      <p class="eyebrow">PRIVATE SPACE</p>
      <h1 id="page-title">私有空间</h1>
      <p>{{ initializationStatus }}</p>
    </section>
  </main>
</template>
