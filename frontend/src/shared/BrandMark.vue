<script setup lang="ts">
import mark from '../assets/brand/private-space.svg'
</script>

<template>
  <span class="brand-mark" aria-hidden="true"><img :src="mark" alt="" width="64" height="64" draggable="false" /></span>
</template>

<style scoped>
.brand-mark { flex-shrink: 0; overflow: hidden; }
.brand-mark > img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
