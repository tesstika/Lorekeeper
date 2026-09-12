<script setup lang="ts" vapor>
import { APP_VERSION } from '@lorekeeper/shared';
import { onMounted, ref } from 'vue';
import ComposerCard from '@/components/settings/ComposerCard.vue';
import EngineCard from '@/components/settings/EngineCard.vue';
import ImageCaptioningCard from '@/components/settings/ImageCaptioningCard.vue';
import PresetCard from '@/components/settings/PresetCard.vue';
import PromptTemplateCard from '@/components/settings/PromptTemplateCard.vue';
import ProviderKeysCard from '@/components/settings/ProviderKeysCard.vue';
import SamplingCard from '@/components/settings/SamplingCard.vue';
import BottomNav from '@/components/ui/BottomNav.vue';
import ErrorBanner from '@/components/ui/ErrorBanner.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import IconRotate from '~icons/lucide/rotate-ccw';
import IconSliders from '~icons/lucide/sliders-horizontal';

const store = useSettingsStore();
const ui = useUiStore();

onMounted(() => {
  void store.load();
});

const confirmingReset = ref(false);

function resetToDefaults(): void {
  if (!confirmingReset.value) {
    confirmingReset.value = true;
    setTimeout(() => {
      confirmingReset.value = false;
    }, 3000);
    return;
  }
  confirmingReset.value = false;
  store.resetToDefaults().catch((error) => ui.notify(String(error), 'error'));
}
</script>

<template>
  <div class="mx-auto min-h-dvh max-w-97.5 border-x border-outline-variant/20 bg-surface pb-24">
    <header class="sticky top-0 z-40 flex items-center justify-between border-b border-outline-variant/30 bg-surface/85 px-5 pb-3 pt-9 backdrop-blur-md">
      <div class="flex items-center gap-2">
        <IconSliders class="size-5 text-primary" />
        <h1 class="text-[20px] font-bold leading-7 tracking-tight text-primary">Settings</h1>
      </div>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors active:opacity-75"
        :class="
          confirmingReset
            ? 'border-error/60 bg-error-container/40 text-error'
            : 'border-outline-variant/40 bg-surface-container text-secondary hover:border-outline-variant hover:text-primary'
        "
        :aria-label="confirmingReset ? 'Confirm reset to defaults' : 'Reset settings to defaults'"
        @click="resetToDefaults()"
      >
        <IconRotate class="size-3.5" />
        {{ confirmingReset ? 'Confirm Reset?' : 'Reset' }}
      </button>
    </header>

    <main class="space-y-6 px-5 pb-6 pt-4">
      <!-- Sanctum status summary -->
      <div class="flex items-start justify-between">
        <div>
          <span class="text-[11px] font-medium uppercase leading-3.5 tracking-wider text-secondary">
            Sanctum Codex Configuration
          </span>
          <p class="mt-0.5 font-serif text-sm leading-6 text-on-surface-variant">
            Parameters governing narrative consciousness and roleplay dynamics.
          </p>
        </div>
        <div
          class="flex shrink-0 items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container-high px-2.5 py-1"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="store.engineReady ? 'animate-pulse bg-emerald-400' : 'bg-outline-variant'"
          ></span>
          <span class="text-[11px] leading-3.5" :class="store.engineReady ? 'text-emerald-300' : 'text-secondary'">
            {{ store.engineReady ? 'Engine Ready' : 'Setup Needed' }}
          </span>
        </div>
      </div>

      <template v-if="store.settings">
        <ProviderKeysCard :providers="store.providers" />
        <EngineCard />
        <SamplingCard />
        <ComposerCard />
        <ImageCaptioningCard />
        <PresetCard />
        <PromptTemplateCard />
      </template>
      <!-- Load failure with retry -->
      <ErrorBanner
        v-else-if="store.loadError"
        :message="`Could not open the sanctum — ${store.loadError}`"
        @retry="store.load(true)"
      />
      <!-- First-fetch skeleton pulse -->
      <div v-else class="space-y-6" aria-hidden="true">
        <div v-for="index in 3" :key="index" class="h-28 animate-pulse rounded-xl border border-outline-variant/20 bg-surface-container-low" />
      </div>

      <!-- Archival version stamp -->
      <div class="space-y-1 pb-2 pt-4 text-center text-[11px] leading-3.5 text-secondary">
        <p>Lorekeeper Sanctum • v{{ APP_VERSION }}</p>
        <p class="text-[10px] text-outline">
          Created by Testika · MIT · keys encrypted at rest (AES-256-GCM)
        </p>
      </div>
    </main>

    <ToastHost />
    <BottomNav />
  </div>
</template>
