<script setup lang="ts" vapor>
defineProps<{ index: number; count: number }>();
const emit = defineEmits<{ prev: []; next: [] }>();
</script>

<template>
  <div
    class="inline-flex select-none items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container px-2.5 py-1 text-[11px] text-secondary"
    role="group"
    aria-label="Variant switcher"
    tabindex="0"
    @keydown.left.prevent="emit('prev')"
    @keydown.right.prevent="emit('next')"
  >
    <button
      type="button"
      aria-label="Previous variant"
      class="flex items-center justify-center transition-colors hover:text-primary"
      @click="emit('prev')"
    >
      <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2"><path d="m15 18-6-6 6-6" /></svg>
    </button>
    <span class="font-mono font-medium tracking-tight text-on-surface">{{ index + 1 }} / {{ count }}</span>
    <button
      type="button"
      aria-label="Next variant"
      class="flex items-center justify-center transition-colors hover:text-primary"
      @click="emit('next')"
    >
      <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2"><path d="m9 18 6-6-6-6" /></svg>
    </button>
  </div>
</template>
