<script setup lang="ts" vapor>
import { ref } from 'vue';
import { ApiError, api } from '@/api';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import { initialsOf } from '@/utils/time';
import IconCamera from '~icons/lucide/camera';
import IconTrash from '~icons/lucide/trash-2';

// Vapor caution (M1 §4.3): no native v-model — the file input is element-ref
// driven, and the avatar value flows strictly through props + explicit emits.
const props = defineProps<{
  url: string | null;
  name: string;
  size?: 'lg' | 'sm';
}>();

const emit = defineEmits<{ 'update:url': [value: string | null] }>();

const ui = useUiStore();
const inputEl = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

function pick(): void {
  inputEl.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // allow re-selecting the same file after a failure
  if (!file) return;
  uploading.value = true;
  try {
    const attachment = await api.uploadAttachment(file);
    emit('update:url', attachment.url);
    ui.notify('Portrait updated', 'success');
  } catch (error) {
    ui.notify(error instanceof ApiError ? error.message : describeApiError(error), 'error');
  } finally {
    uploading.value = false;
  }
}

function remove(): void {
  emit('update:url', null);
}
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <button
      type="button"
      class="group relative cursor-pointer rounded-full p-1 ring-2 ring-primary/40 transition-all hover:ring-primary"
      :class="size === 'sm' ? 'size-20' : 'size-28'"
      :aria-label="url ? 'Change portrait' : 'Upload portrait'"
      :disabled="uploading"
      @click="pick"
    >
      <span
        class="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-surface-container-high"
      >
        <img
          v-if="url"
          :src="url"
          :alt="`${name} portrait`"
          class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span v-else class="font-serif text-2xl text-primary/70">{{ initialsOf(name) }}</span>
      </span>
      <span
        class="absolute -right-1 bottom-0 flex size-8 items-center justify-center rounded-full bg-primary-container text-on-primary-container shadow-lg transition active:scale-90"
      >
        <IconCamera class="size-4" />
      </span>
    </button>
    <span class="text-[10px] uppercase tracking-wider text-outline">
      {{ uploading ? 'Uploading…' : url ? 'Tap to change portrait' : 'Tap to add a portrait' }}
    </span>
    <input ref="inputEl" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" @change="onFileChange" />
    <button
      v-if="url"
      type="button"
      class="flex items-center gap-1 text-[11px] text-secondary transition-colors hover:text-error"
      @click="remove"
    >
      <IconTrash class="size-3.5" /> Remove portrait
    </button>
  </div>
</template>
