<script setup lang="ts" vapor>
defineProps<{ message: string; retryLabel?: string }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div
    role="alert"
    class="flex flex-col items-center gap-2 rounded-xl border border-error/40 bg-error-container/25 px-6 py-8 text-center"
  >
    <svg viewBox="0 0 24 24" class="size-6 fill-none stroke-error stroke-2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
    <p class="font-serif text-[14px] text-error">{{ message }}</p>
    <button
      type="button"
      class="rounded-full border border-error/50 px-4 py-1.5 text-[12.5px] font-medium text-error transition-colors hover:bg-error/15"
      @click="emit('retry')"
    >
      {{ retryLabel ?? 'Retry' }}
    </button>
  </div>
</template>
