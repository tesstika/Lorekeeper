<script setup lang="ts" vapor>
import { useOverlayA11y } from '@/utils/overlayA11y';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();

// M4 a11y: focus trap + Escape-to-close + focus restore for every sheet.
// (Vapor cannot bind template refs — the overlay is marked by data attribute.)
const { token } = useOverlayA11y(() => props.open, { onEscape: () => emit('close') });
</script>

<template>
  <div
    v-if="open"
    :data-lk-overlay="token"
    class="fixed inset-0 z-50 flex items-end justify-center bg-surface-dim/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-[390px] rounded-t-2xl border-t border-outline-variant/40 bg-surface-container px-5 pb-8 pt-4 shadow-2xl">
      <div class="mx-auto mb-3 h-1 w-16 rounded-full bg-outline-variant/50" aria-hidden="true" />
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-[16px] font-semibold text-on-surface">{{ title }}</h2>
        <button
          type="button"
          aria-label="Close sheet"
          class="flex size-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>
      <slot />
    </div>
  </div>
</template>
