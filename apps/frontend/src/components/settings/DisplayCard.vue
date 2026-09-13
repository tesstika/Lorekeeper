<script setup lang="ts" vapor>
import type { BackgroundEffect } from '@lorekeeper/shared';
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import IconSparkles from '~icons/lucide/sparkles';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();
const display = computed(() => store.display);

const EFFECTS: Array<{ id: BackgroundEffect; label: string }> = [
  { id: 'embers', label: 'Embers' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'stars', label: 'Stars' },
  { id: 'off', label: 'Off' },
];

function select(effect: BackgroundEffect): void {
  if (effect === display.value.backgroundEffect) return;
  store.updateDisplay({ backgroundEffect: effect }).catch(() => {
    // Re-sync from the server so the UI reflects the stored state after a failure.
    void store.load(true);
  });
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader :icon="IconSparkles" title="Display & Atmosphere" caption="Background" />
    <div class="space-y-3.5 rounded-xl border border-outline-variant/40 bg-surface-container p-3.5 shadow-sm">
      <div>
        <span class="text-[16px] font-semibold leading-5.5 text-on-surface">Atmospheric background</span>
        <p class="mt-0.5 text-[11px] leading-3.5 text-secondary">
          Gentle ambient motion behind every page. Applies instantly — reduced-motion users see a
          static background.
        </p>
      </div>
      <div role="group" aria-label="Atmospheric background" class="flex gap-1.5">
        <button
          v-for="option in EFFECTS"
          :key="option.id"
          type="button"
          class="flex-1 rounded-full border px-2 py-1.5 text-[12px] font-medium transition-colors"
          :class="display.backgroundEffect === option.id
            ? 'border-primary/30 bg-secondary-container text-primary'
            : 'border-outline-variant/30 bg-surface-container-low text-secondary hover:text-primary'"
          :aria-pressed="display.backgroundEffect === option.id"
          @click="select(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </section>
</template>
