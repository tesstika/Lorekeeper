<script setup lang="ts" vapor>
import BottomNav from '@/components/ui/BottomNav.vue';
import IconBook from '~icons/lucide/book-open-text';
import IconEllipsis from '~icons/lucide/ellipsis-vertical';
import IconPlus from '~icons/lucide/plus';
import IconSearch from '~icons/lucide/search';
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface pb-20">
    <header class="sticky top-0 z-40 flex items-center justify-between bg-surface/85 px-5 pb-3 pt-9 backdrop-blur-md">
      <div class="flex items-center gap-2">
        <IconBook class="size-6 text-primary" />
        <h1 class="text-[22px] font-bold text-on-surface">Characters</h1>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" aria-label="Search characters" class="p-1 text-secondary transition-colors hover:text-primary">
          <IconSearch class="size-5" />
        </button>
        <button type="button" aria-label="Character options" class="p-1 text-secondary transition-colors hover:text-primary">
          <IconEllipsis class="size-5" />
        </button>
      </div>
    </header>

    <div class="flex gap-2 px-5 pb-4">
      <button type="button" class="rounded-full bg-primary-container/25 px-4 py-1.5 text-[13px] font-semibold text-on-surface ring-1 ring-primary/40">
        Characters
      </button>
      <button type="button" class="rounded-full border border-outline-variant/40 px-4 py-1.5 text-[13px] text-secondary transition-colors hover:border-primary/40 hover:text-on-surface">
        Personas
      </button>
    </div>

    <main class="flex flex-1 flex-col items-center justify-center gap-1 px-8 text-center">
      <p class="font-serif text-lg italic text-on-surface-variant/85">No companions yet.</p>
      <p class="text-[13px] text-outline">Create a character or import a Tavern card.</p>
    </main>

    <button
      type="button"
      aria-label="New character"
      class="fixed right-5 bottom-24 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg transition active:scale-95"
    >
      <IconPlus class="size-6" />
    </button>

    <BottomNav />
  </div>
</template>
