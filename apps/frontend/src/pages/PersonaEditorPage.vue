<script setup lang="ts" vapor>
import IconSave from '~icons/lucide/pen-line';
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface">
    <header class="sticky top-0 z-40 flex items-center justify-between bg-surface/85 px-4 pb-2 pt-9 backdrop-blur-md">
      <button type="button" class="text-[15px] font-semibold text-secondary transition-colors hover:text-primary">Cancel</button>
      <div class="text-[15px] font-bold text-on-surface">Edit Persona</div>
      <span class="w-14" />
    </header>

    <main class="flex flex-1 flex-col gap-4 px-4 pb-32">
      <div class="flex flex-col items-center gap-2 pt-1">
        <div class="size-24 rounded-full bg-primary/20 ring-1 ring-primary/40" />
        <span class="text-[10px] font-medium uppercase tracking-wider text-outline">Tap to change portrait</span>
      </div>
      <label class="flex flex-col gap-1.5">
        <span class="text-[12px] font-medium text-secondary">Name</span>
        <input
          type="text"
          placeholder="Who are you in the story?"
          class="rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2.5 text-[15px] text-on-surface outline-none placeholder:text-outline focus:border-primary/60"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[12px] font-medium text-secondary">Description</span>
        <textarea
          rows="5"
          placeholder="Appearance, background, voice…"
          class="resize-none rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2.5 font-serif text-[15px] leading-relaxed text-on-surface outline-none placeholder:text-outline focus:border-primary/60"
        />
      </label>
    </main>

    <footer class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[390px] border-t border-outline-variant/30 bg-surface/95 p-4 backdrop-blur-md">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[15px] font-semibold text-on-primary shadow-lg transition active:scale-95"
      >
        <IconSave class="size-5" /> Save Persona
      </button>
    </footer>
  </div>
</template>
