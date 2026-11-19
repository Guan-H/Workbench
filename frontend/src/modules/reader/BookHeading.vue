<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { ArrowLeft } from 'lucide-vue-next'

defineProps<{ title: string; showBack?: boolean }>()
const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <div class="book-heading">
    <AButton v-if="showBack" type="text" class="book-back" aria-label="返回书目" title="返回书目" @click="emit('back')">
      <ArrowLeft :size="17" /><span>返回书目</span>
    </AButton>
    <h1 :title="title">{{ title }}</h1>
  </div>
</template>

<style scoped>
.book-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
.book-heading h1 { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; }
.book-back { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex-shrink: 0; padding: 0 8px; }
@media (width < 700px) {
  .book-back { width: 44px; height: 44px; }
  .book-back span { display: none; }
}
</style>
