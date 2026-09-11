<script setup lang="ts" vapor>
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2 px-4">
    <div
      v-for="toast in ui.toasts"
      :key="toast.id"
      class="pointer-events-auto max-w-97.5 rounded-lg border px-4 py-2 text-[12px] font-medium shadow-lg backdrop-blur-md"
      :class="{
        'border-outline-variant/40 bg-surface-container-high text-on-surface': toast.tone === 'info',
        'border-emerald-400/40 bg-emerald-950/90 text-emerald-200': toast.tone === 'success',
        'border-error/50 bg-error-container/90 text-on-error-container': toast.tone === 'error',
      }"
    >
      {{ toast.message }}
    </div>
  </div>
</template>
