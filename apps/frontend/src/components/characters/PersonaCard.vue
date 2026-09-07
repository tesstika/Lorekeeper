<script setup lang="ts" vapor>
import type { Persona } from '@lorekeeper/shared';
import { firstLine, formatRelativeTime, initialsOf } from '@/utils/time';
import IconChevronRight from '~icons/lucide/chevron-right';
import IconStar from '~icons/lucide/star';
import IconTrash from '~icons/lucide/trash-2';

defineProps<{ persona: Persona }>();

const emit = defineEmits<{
  open: [];
  delete: [];
  setDefault: [];
}>();
</script>

<template>
  <article
    class="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface-container shadow-md transition-all duration-300 hover:border-tertiary/50"
    :class="persona.isDefault ? 'border-tertiary/60' : 'border-outline-variant/30'"
    role="button"
    tabindex="0"
    :aria-label="`Open persona ${persona.name}`"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <div class="flex items-center gap-3 p-3.5">
      <div
        class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-tertiary/40"
      >
        <img
          v-if="persona.avatarPath"
          :src="persona.avatarPath"
          :alt="`${persona.name} portrait`"
          class="h-full w-full object-cover"
        />
        <span v-else class="font-serif text-lg text-tertiary">{{ initialsOf(persona.name) }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <h2 class="truncate text-[15px] font-semibold text-on-surface group-hover:text-tertiary">
            {{ persona.name }}
          </h2>
          <span
            v-if="persona.isDefault"
            class="rounded-full bg-tertiary/20 px-1.5 py-0.5 text-[10px] font-semibold text-tertiary"
          >
            Default
          </span>
        </div>
        <p class="mt-0.5 truncate text-[11px] text-secondary">
          {{ firstLine(persona.description, 60) || 'No description yet' }}
        </p>
        <p class="mt-1 text-[10px] text-outline">{{ formatRelativeTime(persona.updatedAt) }}</p>
      </div>
      <div class="flex flex-col items-center gap-1.5">
        <button
          v-if="!persona.isDefault"
          type="button"
          class="flex size-8 items-center justify-center rounded-full text-secondary opacity-0 transition-all hover:text-tertiary focus:opacity-100 group-hover:opacity-100"
          :aria-label="`Set ${persona.name} as default persona`"
          @click.stop="emit('setDefault')"
        >
          <IconStar class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-8 items-center justify-center rounded-full text-secondary opacity-0 transition-all hover:text-error focus:opacity-100 group-hover:opacity-100"
          :aria-label="`Delete persona ${persona.name}`"
          @click.stop="emit('delete')"
        >
          <IconTrash class="size-4" />
        </button>
        <IconChevronRight class="size-4 text-secondary/70" />
      </div>
    </div>
  </article>
</template>
