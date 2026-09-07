<script setup lang="ts" vapor>
import IconSend from '~icons/lucide/arrow-up';
import IconChevronLeft from '~icons/lucide/chevron-left';
import IconPaperclip from '~icons/lucide/paperclip';
import IconSettings from '~icons/lucide/settings';
</script>

<template>
  <div class="mx-auto flex h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface">
    <header class="z-40 border-b border-outline-variant/30 px-4 pb-2 pt-9">
      <nav class="flex items-center justify-between">
        <button type="button" aria-label="Back to chats" class="p-1 text-on-surface transition-colors hover:text-primary">
          <IconChevronLeft class="size-6" />
        </button>
        <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2">
          <div class="size-8 flex-shrink-0 rounded-full bg-surface-container ring-1 ring-primary/40" />
          <span class="truncate text-[15px] font-semibold text-on-surface">Lorekeeper</span>
          <span class="flex flex-shrink-0 items-center gap-1 rounded-full border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 text-[10.5px] font-medium text-primary">
            <span class="size-1.5 animate-pulse rounded-full bg-primary" />Model
          </span>
        </div>
        <button type="button" aria-label="Chat settings" class="p-1.5 text-on-surface-variant transition-colors hover:text-primary">
          <IconSettings class="size-5" />
        </button>
      </nav>
    </header>

    <main class="flex flex-1 items-center justify-center px-8 text-center">
      <p class="font-serif text-lg italic text-on-surface-variant/85">The first message will appear here.</p>
    </main>

    <footer class="border-t border-outline-variant/30 px-4 pb-6 pt-2">
      <div class="flex items-end gap-1.5 rounded-xl border border-outline-variant/40 bg-surface-container p-1.5 shadow-lg transition-colors focus-within:border-primary/60">
        <button type="button" aria-label="Attach image" class="flex size-9 flex-shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary">
          <IconPaperclip class="size-5" />
        </button>
        <textarea
          rows="2"
          placeholder="Write your action or speak in &quot;quotes&quot;..."
          class="max-h-24 flex-1 resize-none self-center bg-transparent px-1 py-1 font-serif leading-relaxed text-on-surface outline-none placeholder:text-outline"
        />
        <button
          type="button"
          aria-label="Send message"
          class="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 font-bold text-[#1f1608] shadow-md transition hover:brightness-110 active:scale-95"
        >
          <IconSend class="size-5" />
        </button>
      </div>
    </footer>
  </div>
</template>
