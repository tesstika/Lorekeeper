<script setup lang="ts" vapor>
import BottomNav from '@/components/ui/BottomNav.vue';
import IconBook from '~icons/lucide/book-open-text';
import IconPlus from '~icons/lucide/plus';
import IconSearch from '~icons/lucide/search';
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface pb-20">
    <header class="sticky top-0 z-40 flex items-center justify-between bg-surface/85 px-5 pb-3 pt-9 backdrop-blur-md">
      <div class="flex items-center gap-2">
        <IconBook class="size-6 text-primary" />
        <h1 class="text-[22px] font-bold text-on-surface">Lorekeeper</h1>
      </div>
      <button type="button" aria-label="Search chronicles" class="p-1 text-secondary transition-colors hover:text-primary">
        <IconSearch class="size-5" />
      </button>
    </header>

    <div class="flex gap-2 px-5 pb-4">
      <button type="button" class="rounded-full bg-primary-container/25 px-4 py-1.5 text-[13px] font-semibold text-on-surface ring-1 ring-primary/40">
        <span class="mr-1 inline-block size-1.5 rounded-full bg-primary align-middle" />All Chronicles
      </button>
      <button type="button" class="rounded-full border border-outline-variant/40 px-4 py-1.5 text-[13px] text-secondary transition-colors hover:border-primary/40 hover:text-on-surface">
        In Progress
      </button>
      <button type="button" class="rounded-full border border-outline-variant/40 px-4 py-1.5 text-[13px] text-secondary transition-colors hover:border-primary/40 hover:text-on-surface">
        Archived
      </button>
    </div>

    <main class="flex flex-1 flex-col items-center justify-center gap-1 px-8 text-center">
      <p class="font-serif text-lg italic text-on-surface-variant/85">Your library is empty.</p>
      <p class="text-[13px] text-outline">Begin your first tale with a character.</p>
    </main>

    <button
      type="button"
      class="fixed bottom-24 right-5 z-40 mx-auto flex w-[calc(100%-2.5rem)] max-w-[340px] items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-[15px] font-semibold text-on-primary shadow-lg transition active:scale-95"
    >
      <IconPlus class="size-5" /> New Tale
    </button>

    <BottomNav />
  </div>
</template>
