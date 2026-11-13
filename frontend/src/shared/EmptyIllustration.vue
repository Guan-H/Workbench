<script setup lang="ts">
defineProps<{ kind: 'notes' | 'reading' | 'mindmap' | 'trash' }>()
</script>

<template>
  <svg class="empty-illustration" :data-illustration="kind" width="188" height="128" viewBox="0 0 200 136" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="100" cy="116" rx="72" ry="9" fill="var(--color-paper-tint)" />
    <circle cx="34" cy="36" r="5" fill="#e6edf4" />
    <circle cx="164" cy="77" r="7" fill="#f0e5d9" />
    <path d="M158 24v10m-5-5h10" stroke="#c7b59f" stroke-width="2" stroke-linecap="round" />
    <g v-if="kind === 'notes'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
      <rect x="61" y="24" width="78" height="88" rx="8" fill="#eee7dd" transform="rotate(-7 100 68)" />
      <path d="M69 16h48l20 20v65a7 7 0 0 1-7 7H69a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7Z" fill="white" stroke="#9aaaba" />
      <path d="M117 16v20h20M78 51h38M78 65h29M78 79h20" stroke="#a4b1be" />
      <path d="m113 91 23-30 9 7-23 30-13 6Z" fill="#d9e4ee" stroke="#617c96" />
      <path d="m132 66 9 7" stroke="#617c96" />
    </g>
    <g v-else-if="kind === 'reading'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
      <rect x="48" y="80" width="100" height="24" rx="5" fill="#e5edf4" stroke="#93a7b9" />
      <path d="M60 80v24m75-12h-55" stroke="#93a7b9" />
      <rect x="53" y="57" width="93" height="23" rx="5" fill="#f2e7da" stroke="#b49777" transform="rotate(-5 100 68)" />
      <path d="M100 38c-15-10-30-13-48-7v38c19-5 33-2 48 7 15-9 29-12 48-7V31c-18-6-33-3-48 7Z" fill="white" stroke="#8d9eac" />
      <path d="M100 38v38M62 42l24 5M62 53l20 4m32-10 24-5m-24 16 24-5" stroke="#aab7c1" />
    </g>
    <g v-else-if="kind === 'mindmap'" stroke-linecap="round" stroke-width="2">
      <path d="M91 66H66c-12 0-12-30-24-30h-7m56 30H62c-12 0-12 28-24 28h-3m74-28h25c12 0 12-29 24-29h7m-56 29h24c12 0 12 28 24 28h9" stroke="#b0a3c1" />
      <rect x="68" y="49" width="64" height="34" rx="10" fill="#eee8f4" stroke="#9a87af" />
      <rect x="18" y="25" width="38" height="23" rx="7" fill="white" stroke="#a5b6c6" />
      <rect x="16" y="83" width="38" height="23" rx="7" fill="white" stroke="#b8a18a" />
      <rect x="147" y="25" width="38" height="23" rx="7" fill="white" stroke="#b8a18a" />
      <rect x="147" y="83" width="38" height="23" rx="7" fill="white" stroke="#a5b6c6" />
      <path d="M82 66h36" stroke="#9a87af" />
    </g>
    <g v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
      <path d="m62 47 8 62a7 7 0 0 0 7 6h46a7 7 0 0 0 7-6l8-62" fill="#f1ece4" stroke="#aa9a86" />
      <path d="M53 45h95M81 28h38l5 13M84 64v33m16-33v33m16-33v33" stroke="#aa9a86" />
      <rect x="79" y="13" width="35" height="40" rx="4" fill="white" stroke="#97a9b9" transform="rotate(-12 97 33)" />
      <path d="m88 24 16-3m-14 13 16-3" stroke="#97a9b9" />
    </g>
  </svg>
</template>

<style scoped>
.empty-illustration { display: block; flex-shrink: 0; max-width: 100%; margin: 0 auto 18px; }
</style>
