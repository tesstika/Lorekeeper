<script setup lang="ts" vapor>
import type { AttachmentInfo } from '@lorekeeper/shared';
import { ref } from 'vue';
import ImageLightbox from './ImageLightbox.vue';

defineProps<{ attachments: AttachmentInfo[] }>();

/** The attachment shown in the full-screen lightbox (null = closed). */
const activeAttachment = ref<AttachmentInfo | null>(null);
</script>

<template>
  <div v-if="attachments.length > 0" class="flex flex-wrap gap-2 pl-7">
    <button
      v-for="attachment in attachments"
      :key="attachment.id"
      type="button"
      class="group relative overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container transition-colors hover:border-primary/50"
      :aria-label="`View image ${attachment.originalName}`"
      @click="activeAttachment = attachment"
    >
      <img
        :src="attachment.url"
        :alt="attachment.originalName"
        class="size-20 object-cover"
        loading="lazy"
      />
    </button>

    <!-- Lightbox (D-T7): click thumbnail → full-screen viewer. -->
    <ImageLightbox
      v-if="activeAttachment"
      :attachment="activeAttachment"
      @close="activeAttachment = null"
    />
  </div>
</template>
