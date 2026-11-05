<script setup lang="ts">
import { Button as AButton, Pagination as APagination } from 'ant-design-vue'

withDefaults(defineProps<{ page: number; pages: number; disabled?: boolean; total?: number; pageSize?: number }>(), { disabled: false, pageSize: 1 })
const emit = defineEmits<{ 'update:page': [page: number] }>()
</script>

<template>
  <APagination class="app-pagination" :current="page" :total="total ?? pages * pageSize" :page-size="pageSize" :show-size-changer="false" :disabled="disabled" size="small" @change="emit('update:page', $event)">
    <template #itemRender="{ type, originalElement }">
      <AButton v-if="type === 'prev'" size="small" :disabled="disabled || page === 1">上一页</AButton>
      <AButton v-else-if="type === 'next'" size="small" :disabled="disabled || page >= pages">下一页</AButton>
      <component :is="originalElement" v-else />
    </template>
  </APagination>
</template>
