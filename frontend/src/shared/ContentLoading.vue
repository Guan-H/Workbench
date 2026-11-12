<script setup lang="ts">
import { Skeleton as ASkeleton, Spin as ASpin } from 'ant-design-vue';
import { onBeforeUnmount, ref, watch } from 'vue';
const props = withDefaults(defineProps<{
    label?: string;
    pending?: boolean;
    skeleton?: boolean;
}>(), {
    label: '正在加载内容…', pending: true, skeleton: false,
});
const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => props.pending, pending => {
    clearTimeout(timer);
    visible.value = false;
    if (pending)
        timer = setTimeout(() => { visible.value = true; }, 120);
}, { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <Transition name="content-loading">
    <div v-if="visible" class="content-loading" :class="{ 'content-loading-skeleton': skeleton }" role="status" aria-live="polite">
      <div class="content-loading-label"><ASpin size="small" /><span>{{ label }}</span></div>
      <ASkeleton v-if="skeleton" active :title="false" :paragraph="{ rows: 4 }" />
    </div>
  </Transition>
</template>

<style scoped>
.content-loading {padding:12px 20px;color:var(--color-text-muted);font-size:13px;pointer-events:none}
.content-loading-label {display:flex;align-items:center;gap:10px}
.content-loading-skeleton {padding:24px;flex:1;min-height:160px}
.content-loading-skeleton .content-loading-label {margin-bottom:24px}
.content-loading-enter-active {transition:opacity 120ms ease-out}
.content-loading-enter-from {opacity:0}
@media(prefers-reduced-motion:reduce){.content-loading-enter-active{transition:none}.content-loading :deep(.ant-spin-dot),.content-loading :deep(.ant-spin-dot-item),.content-loading :deep(.ant-skeleton-paragraph>li){animation:none!important}}
</style>
