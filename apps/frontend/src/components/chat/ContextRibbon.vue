<script setup lang="ts" vapor>
defineProps<{ ribbon: string | null; turn: number }>();
</script>

<template>
  <div class="flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-lowest/60 px-5 py-1">
    <div class="flex min-w-0 items-center gap-1.5 text-secondary">
      <svg viewBox="0 0 24 24" class="size-3.5 shrink-0 fill-none stroke-primary stroke-2" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" /></svg>
      <span class="truncate font-serif text-[12px] italic tracking-wide text-on-surface-variant/90">
        {{ ribbon && ribbon.trim().length > 0 ? ribbon : 'Untitled chapter' }}
      </span>
    </div>
    <span class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-outline">Turn {{ turn }}</span>
  </div>
</template>
