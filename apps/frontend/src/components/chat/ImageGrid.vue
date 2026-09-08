<script setup lang="ts" vapor>
import type { AttachmentInfo } from '@lorekeeper/shared';
import { useUiStore } from '@/stores/ui';

defineProps<{ attachments: AttachmentInfo[] }>();
const ui = useUiStore();
</script>

<template>
  <div v-if="attachments.length > 0" class="flex flex-wrap gap-2 pl-7">
    <button
      v-for="attachment in attachments"
      :key="attachment.id"
      type="button"
      class="group relative overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container"
      :aria-label="`Attached image ${attachment.originalName}`"
      @click="ui.notify(`Attachment: ${attachment.originalName} (${attachment.mimeType})`, 'info')"
    >
      <img
        :src="attachment.url"
        :alt="attachment.originalName"
        class="size-20 object-cover"
        loading="lazy"
      />
    </button>
  </div>
</template>
