<script setup lang="ts" vapor>
import type { Character } from '@lorekeeper/shared';
import { ref } from 'vue';
import { firstLine, formatRelativeTime, initialsOf } from '@/utils/time';
import IconChevronRight from '~icons/lucide/chevron-right';
import IconDownload from '~icons/lucide/download';
import IconEdit from '~icons/lucide/pen-line';
import IconTrash from '~icons/lucide/trash-2';

// Card per the characters mockup: 4/3 image well with vignette + genre pill,
// name/tagline meta, and a long-press / ⋯ action overlay (Edit/Export/Delete).
const props = defineProps<{ character: Character }>();

const emit = defineEmits<{
  open: [];
  edit: [];
  exportCard: [];
  delete: [];
}>();

const overlayOpen = ref(false);
let pressTimer: ReturnType<typeof setTimeout> | undefined;

function startPress(): void {
  clearPress();
  pressTimer = setTimeout(() => {
    pressTimer = undefined;
    overlayOpen.value = true;
  }, 450);
}

function clearPress(): void {
  if (pressTimer !== undefined) {
    clearTimeout(pressTimer);
    pressTimer = undefined;
  }
}

function onActivate(): void {
  if (overlayOpen.value) return;
  emit('open');
}

function actions(event: Event): void {
  event.stopPropagation();
  overlayOpen.value = !overlayOpen.value;
}

const genreTag = () => props.character.tags[0] ?? null;
</script>

<template>
  <article
    class="group relative flex flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container shadow-md transition-all duration-300 hover:border-primary/50"
    @pointerdown="startPress"
    @pointerup="clearPress"
    @pointerleave="clearPress"
    @pointercancel="clearPress"
  >
    <button
      type="button"
      class="relative block w-full text-left"
      :aria-label="`Open ${character.name}`"
      @click="onActivate"
    >
      <div class="relative aspect-[4/3] w-full overflow-hidden bg-surface-container-low">
        <img
          v-if="character.avatarPath"
          :src="character.avatarPath"
          :alt="`${character.name} portrait`"
          class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary-container/60 to-surface-container-lowest"
        >
          <span class="font-serif text-3xl text-primary/80">{{ initialsOf(character.name) }}</span>
        </div>
        <div
          class="pointer-events-none absolute inset-0"
          style="background: linear-gradient(180deg, rgba(21, 18, 25, 0.05) 0%, rgba(21, 18, 25, 0.3) 50%, rgba(34, 30, 38, 0.95) 100%)"
        />
        <span
          v-if="genreTag()"
          class="absolute left-2.5 top-2.5 rounded-md border border-outline-variant/20 bg-surface-container-lowest/80 px-2 py-0.5 text-[11px] font-medium text-primary backdrop-blur-md"
        >
          {{ genreTag() }}
        </span>
      </div>
      <div class="flex flex-1 flex-col justify-between bg-surface-container p-3">
        <div>
          <h2 class="truncate text-[15px] font-semibold text-on-surface transition-colors group-hover:text-primary">
            {{ character.name }}
          </h2>
          <p class="mt-1 flex items-center gap-1 truncate text-[11px] text-secondary">
            <span class="truncate italic">{{ character.tagline || firstLine(character.description, 48) || 'No tagline yet' }}</span>
          </p>
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-outline-variant/20 pt-2 text-secondary/80 transition-colors group-hover:text-primary">
          <span class="text-[11px] italic">{{ formatRelativeTime(character.updatedAt) }}</span>
          <IconChevronRight class="size-4" />
        </div>
      </div>
    </button>

    <button
      type="button"
      class="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full border border-outline-variant/40 bg-surface-container-lowest/80 text-on-surface opacity-0 backdrop-blur-md transition-all hover:text-primary focus:opacity-100 group-hover:opacity-100 md:opacity-0"
      :aria-label="`Actions for ${character.name}`"
      :data-actions-open="overlayOpen"
      @click="actions"
    >
      <span class="text-lg leading-none">⋯</span>
    </button>

    <div
      v-if="overlayOpen"
      class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-surface-container-lowest/70 p-2 backdrop-blur-sm"
      @click.self="overlayOpen = false"
    >
      <span class="text-[11px] font-medium text-on-surface-variant">Selected Companion</span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-full border border-outline-variant/40 bg-surface-container-high text-on-surface shadow-lg transition-all hover:text-primary active:scale-95"
          :aria-label="`Edit ${character.name}`"
          @click="emit('edit')"
        >
          <IconEdit class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-full border border-outline-variant/40 bg-surface-container-high text-on-surface shadow-lg transition-all hover:text-primary active:scale-95"
          :aria-label="`Export ${character.name} card`"
          @click="emit('exportCard')"
        >
          <IconDownload class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-full border border-error/30 bg-error-container text-on-error shadow-lg transition-all hover:bg-error active:scale-95"
          :aria-label="`Delete ${character.name}`"
          @click="emit('delete')"
        >
          <IconTrash class="size-4" />
        </button>
      </div>
      <span class="mt-1 text-[10px] text-secondary/60">Tap backdrop to dismiss</span>
    </div>
  </article>
</template>
