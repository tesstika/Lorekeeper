<script setup lang="ts" vapor>
import type { AttachmentInfo } from '@lorekeeper/shared';
import { useOverlayA11y } from '@/utils/overlayA11y';

defineProps<{ attachment: AttachmentInfo }>();
const emit = defineEmits<{ close: [] }>();

// M4 a11y (D-T7): the lightbox is a full-screen dialog — focus trapped,
// Escape closes, backdrop click closes, focus returns to the thumbnail.
// The component only mounts while open, so the trap activates immediately.
// (Vapor cannot bind template refs — the overlay is marked by data attribute.)
const { token } = useOverlayA11y(() => true, { onEscape: () => emit('close') });
</script>

<template>
  <div
    :data-lk-overlay="token"
    class="fixed inset-0 z-70 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
    role="dialog"
    aria-modal="true"
    :aria-label="`Image viewer — ${attachment.originalName}`"
    tabindex="-1"
    @click.self="emit('close')"
  >
    <button
      type="button"
      aria-label="Close image viewer"
      class="absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-full bg-surface-container/80 text-on-surface shadow-lg transition-colors hover:bg-surface-container-high hover:text-primary"
      @click="emit('close')"
    >
      <svg viewBox="0 0 24 24" class="size-6 fill-none stroke-current stroke-2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
    <figure class="flex max-h-full max-w-full flex-col items-center gap-2" @click="emit('close')">
      <img
        :src="attachment.url"
        :alt="attachment.originalName"
        class="max-h-[85dvh] max-w-full rounded-lg object-contain shadow-2xl"
      >
      <figcaption class="text-[11.5px] text-secondary">{{ attachment.originalName }}</figcaption>
    </figure>
  </div>
</template>
