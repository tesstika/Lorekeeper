<script setup lang="ts" vapor>
import IconPresets from '~icons/lucide/bookmark';
import IconBrain from '~icons/lucide/brain';
import IconKey from '~icons/lucide/key-round';
import IconComposer from '~icons/lucide/pen-tool';
import IconRotate from '~icons/lucide/rotate-ccw';
import IconSliders from '~icons/lucide/sliders-horizontal';

const cards = [
  { icon: IconKey, title: 'API Providers & Keys', subtitle: 'OpenRouter & UnoRouter connections' },
  { icon: IconBrain, title: 'Intelligence Engine', subtitle: 'Default provider, model & persona' },
  {
    icon: IconSliders,
    title: 'Sampling & Context Tuning',
    subtitle: 'Temperature, penalties, stop sequences',
  },
  {
    icon: IconComposer,
    title: 'Composer Behavior',
    subtitle: 'Enter-to-send, auto-scroll, animations',
  },
  { icon: IconPresets, title: 'Saved Generation Presets', subtitle: 'Reusable parameter bundles' },
];
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface pb-24">
    <header class="sticky top-0 z-40 flex items-center justify-between bg-surface/85 px-5 pb-3 pt-9 backdrop-blur-md">
      <div class="flex items-center gap-2">
        <IconSliders class="size-6 text-primary" />
        <h1 class="text-[22px] font-bold text-on-surface">Settings</h1>
      </div>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full border border-outline-variant/40 px-3 py-1.5 text-[12px] font-medium text-secondary transition-colors hover:border-error/50 hover:text-error"
      >
        <IconRotate class="size-3.5" /> Reset
      </button>
    </header>

    <main class="flex flex-1 flex-col gap-3 px-4 pt-2">
      <section
        v-for="card in cards"
        :key="card.title"
        class="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4"
      >
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-surface-container">
            <component :is="card.icon" class="size-5 text-primary" />
          </div>
          <div>
            <div class="text-[14px] font-semibold text-on-surface">{{ card.title }}</div>
            <div class="text-[11px] text-outline">{{ card.subtitle }}</div>
          </div>
        </div>
      </section>

      <p class="mt-2 text-center text-[11px] text-outline">
        Lorekeeper — created by Testika · MIT · v0.1.0
      </p>
    </main>
  </div>
</template>
