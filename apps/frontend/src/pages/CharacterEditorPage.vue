<script setup lang="ts" vapor>
import IconPersonality from '~icons/lucide/badge-check';
import IconBackstory from '~icons/lucide/book-open';
import IconChevronDown from '~icons/lucide/chevron-down';
import IconEllipsis from '~icons/lucide/ellipsis-vertical';
import IconEye from '~icons/lucide/eye';
import IconDialogue from '~icons/lucide/messages-square';
import IconSave from '~icons/lucide/pen-line';
import IconAdvanced from '~icons/lucide/sliders-horizontal';

const sections = [
  {
    icon: IconPersonality,
    title: 'Personality & Essence',
    subtitle: 'Core demeanor, quirks & manners',
  },
  {
    icon: IconBackstory,
    title: 'Backstory & Scenario',
    subtitle: 'Origins, stakes & setting anchors',
  },
  { icon: IconDialogue, title: 'Dialogue & Greeting', subtitle: 'First impression & cadence' },
  {
    icon: IconAdvanced,
    title: 'Advanced & System Directives',
    subtitle: 'LLM constraints & tuning',
  },
];
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface">
    <header class="sticky top-0 z-40 flex items-center justify-between bg-surface/85 px-4 pb-2 pt-9 backdrop-blur-md">
      <button type="button" class="text-[15px] font-semibold text-secondary transition-colors hover:text-primary">Cancel</button>
      <div class="text-center">
        <div class="text-[15px] font-bold text-on-surface">Edit Character</div>
        <div class="text-[11px] text-outline">Manuscript Archive</div>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" aria-label="Preview" class="p-1.5 text-on-surface-variant transition-colors hover:text-primary">
          <IconEye class="size-5" />
        </button>
        <button type="button" aria-label="More options" class="p-1.5 text-on-surface-variant transition-colors hover:text-primary">
          <IconEllipsis class="size-5" />
        </button>
      </div>
    </header>

    <div class="flex gap-2 px-4 pb-4">
      <button type="button" class="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-container py-2.5 text-[13px] font-semibold text-on-surface ring-1 ring-primary/40">
        Character (Full Lore)
      </button>
      <button type="button" class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-outline-variant/40 py-2.5 text-[13px] text-secondary">
        Persona (Player)
      </button>
    </div>

    <main class="flex flex-1 flex-col gap-3 px-4 pb-32">
      <div class="flex flex-col items-center gap-2 pt-1">
        <div class="size-24 rounded-full bg-surface-container ring-1 ring-primary/40" />
        <span class="text-[10px] font-medium uppercase tracking-wider text-outline">Tap to change portrait</span>
        <input
          type="text"
          placeholder="Character name"
          class="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2.5 text-[15px] font-semibold text-on-surface outline-none placeholder:text-outline focus:border-primary/60"
        />
      </div>

      <section
        v-for="section in sections"
        :key="section.title"
        class="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <component :is="section.icon" class="size-5 text-primary" />
            <div>
              <div class="text-[14px] font-semibold text-on-surface">{{ section.title }}</div>
              <div class="text-[11px] text-outline">{{ section.subtitle }}</div>
            </div>
          </div>
          <IconChevronDown class="size-4 text-secondary" />
        </div>
      </section>
    </main>

    <footer class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[390px] border-t border-outline-variant/30 bg-surface/95 p-4 backdrop-blur-md">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[15px] font-semibold text-on-primary shadow-lg transition active:scale-95"
      >
        <IconSave class="size-5" /> Save Character
      </button>
    </footer>
  </div>
</template>
