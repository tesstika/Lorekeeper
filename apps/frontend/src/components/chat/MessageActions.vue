<script setup lang="ts" vapor>
defineProps<{
  canRegenerate?: boolean;
  canEdit?: boolean;
  canRetry?: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ regenerate: []; edit: []; copy: []; delete: []; retry: [] }>();
</script>

<template>
  <div
    class="flex items-center gap-0.5 rounded-lg border border-outline-variant/30 bg-surface-container/90 px-1 py-0.5 text-on-surface-variant backdrop-blur-sm transition-opacity"
    :class="busy ? 'pointer-events-none opacity-40' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'"
  >
    <button
      v-if="canRetry"
      type="button"
      aria-label="Retry reply"
      title="Retry"
      class="flex items-center justify-center rounded p-1 transition-colors hover:bg-surface-container-high hover:text-primary"
      @click="emit('retry')"
    >
      <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
    </button>
    <button
      v-if="canRegenerate"
      type="button"
      aria-label="Regenerate reply"
      title="Regenerate"
      class="flex items-center justify-center rounded p-1 transition-colors hover:bg-surface-container-high hover:text-primary"
      @click="emit('regenerate')"
    >
      <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
    </button>
    <button
      v-if="canEdit"
      type="button"
      aria-label="Edit message"
      title="Edit"
      class="flex items-center justify-center rounded p-1 transition-colors hover:bg-surface-container-high hover:text-primary"
      @click="emit('edit')"
    >
      <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
    </button>
    <button
      type="button"
      aria-label="Copy message"
      title="Copy"
      class="flex items-center justify-center rounded p-1 transition-colors hover:bg-surface-container-high hover:text-primary"
      @click="emit('copy')"
    >
      <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
    </button>
    <button
      type="button"
      aria-label="Delete message"
      title="Delete"
      class="flex items-center justify-center rounded p-1 transition-colors hover:bg-surface-container-high hover:text-error"
      @click="emit('delete')"
    >
      <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
    </button>
  </div>
</template>
