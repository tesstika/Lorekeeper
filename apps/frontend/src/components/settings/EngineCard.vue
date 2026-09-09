<script setup lang="ts" vapor>
import type { ModelInfo, ProviderId } from '@lorekeeper/shared';
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import {
  formatContextLength,
  formatModelPricing,
  isVisionModel,
  modalityUnknown,
} from '@/utils/model-format';
import { useOverlayA11y } from '@/utils/overlayA11y';
import IconBrain from '~icons/lucide/brain';
import IconCheck from '~icons/lucide/check';
import IconChevronDown from '~icons/lucide/chevron-down';
import IconEye from '~icons/lucide/eye';
import IconLoader from '~icons/lucide/loader-circle';
import IconRefresh from '~icons/lucide/refresh-cw';
import IconSearch from '~icons/lucide/search';
import IconX from '~icons/lucide/x';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();
const ui = useUiStore();

const libraryOpen = ref(false);
const search = ref('');
const loading = ref(false);
const refreshing = ref(false);

const providerOptions = computed(() =>
  store.providers.map((p) => ({ id: p.id as ProviderId, label: p.label, hasKey: p.hasKey })),
);

const catalog = computed(() => store.activeProviderCatalog?.models ?? []);
const filteredModels = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return catalog.value;
  return catalog.value.filter(
    (model) => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
  );
});
const fetchedAt = computed(() => store.activeProviderCatalog?.fetchedAt ?? null);

const manualModelId = ref('');
const manualDirty = computed(() => manualModelId.value.trim() !== (store.activeModelId ?? ''));

// M4 a11y: the model-library modal traps focus, closes on Escape and
// restores focus to its trigger. (Vapor cannot bind template refs — the
// overlay is marked by data attribute.)
const { token: libraryToken } = useOverlayA11y(() => libraryOpen.value, {
  onEscape: () => {
    libraryOpen.value = false;
  },
});

watch(libraryOpen, (open) => {
  if (!open) return;
  search.value = '';
  void ensureCatalog(false);
});

async function ensureCatalog(refresh: boolean): Promise<void> {
  const providerId = store.activeProviderId;
  if (!providerId) {
    ui.notify('Select a provider first', 'error');
    return;
  }
  const provider = store.providers.find((p) => p.id === providerId);
  if (!provider?.hasKey) {
    ui.notify(`Save an API key for ${provider?.label ?? providerId} to browse models`, 'error');
    return;
  }
  if (refresh) {
    refreshing.value = true;
  } else {
    loading.value = true;
  }
  try {
    await store.fetchProviderModels(providerId, refresh);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function selectProvider(id: ProviderId): void {
  void store
    .updateGlobalDefaults({ providerId: id })
    .then(() => ui.notify('Default provider updated', 'success'))
    .catch((error) => ui.notify(describeApiError(error), 'error'));
}

function selectModel(model: ModelInfo): void {
  void store
    .updateGlobalDefaults({ modelId: model.id })
    .then(() => {
      ui.notify(`Default model set to ${model.name}`, 'success');
      libraryOpen.value = false;
    })
    .catch((error) => ui.notify(describeApiError(error), 'error'));
}

function applyManualModel(): void {
  const id = manualModelId.value.trim();
  if (!id) return;
  void store
    .updateGlobalDefaults({ modelId: id })
    .then(() => ui.notify(`Default model set to ${id}`, 'success'))
    .catch((error) => ui.notify(describeApiError(error), 'error'));
}

function contextTag(model: ModelInfo): string | null {
  return formatContextLength(model.contextLength);
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader
      :icon="IconBrain"
      title="Intelligence Engine"
      :caption="store.activePreset?.name ?? 'No preset selected'"
    />
    <div class="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-sm">
      <!-- Provider selector -->
      <div class="flex items-center gap-2 p-3.5">
        <span class="text-[11px] font-medium tracking-wide text-secondary">Provider</span>
        <div class="flex flex-1 justify-end gap-1.5">
          <button
            v-for="option in providerOptions"
            :key="option.id"
            type="button"
            class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
            :class="
              store.activeProviderId === option.id
                ? 'border-primary-container/60 bg-primary-container/20 text-primary'
                : 'border-outline-variant/40 bg-surface-container-low text-secondary hover:border-outline-variant hover:text-on-surface'
            "
            :aria-pressed="store.activeProviderId === option.id"
            @click="selectProvider(option.id)"
          >
            <IconCheck v-if="store.activeProviderId === option.id" class="size-3" />
            {{ option.label }}
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="option.hasKey ? 'bg-emerald-400' : 'bg-outline-variant'"
              :title="option.hasKey ? 'Key saved' : 'No key'"
            ></span>
          </button>
        </div>
      </div>

      <!-- Active model selector -->
      <button
        type="button"
        class="group flex w-full items-center justify-between p-3.5 text-left transition-colors hover:bg-surface-container-high"
        :aria-label="'Open model library'"
        @click="libraryOpen = true"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-highest text-primary-container shadow-inner">
            <IconBrain class="size-6" />
          </div>
          <div>
            <div class="text-[16px] font-semibold leading-[22px] text-on-surface transition-colors group-hover:text-primary">
              {{ store.activeModelId ?? 'No model selected' }}
            </div>
            <div class="mt-0.5 flex items-center gap-2">
              <span
                v-if="store.activeProviderId"
                class="rounded-full border border-primary-container/30 bg-primary-container/20 px-2 py-0.5 text-[11px] font-medium text-primary-container"
              >
                via {{ store.activeProvider?.label ?? store.activeProviderId }}
              </span>
              <span v-if="store.activeModelInfo && contextTag(store.activeModelInfo)" class="text-[11px] leading-[14px] text-secondary">
                {{ contextTag(store.activeModelInfo) }} context
                <template v-if="isVisionModel(store.activeModelInfo)"> • vision</template>
                <template v-else-if="modalityUnknown(store.activeModelInfo)"> • modality unknown</template>
              </span>
              <span v-if="store.activeModelInfo && formatModelPricing(store.activeModelInfo)" class="text-[11px] leading-[14px] text-secondary">
                {{ formatModelPricing(store.activeModelInfo) }}
              </span>
            </div>
          </div>
        </div>
        <IconChevronDown class="size-5 text-on-surface-variant transition-colors group-hover:text-primary" />
      </button>

      <!-- Browse library quick link -->
      <div class="flex items-center justify-between bg-surface-container-low p-3">
        <div class="flex items-center gap-2 text-on-surface-variant">
          <IconSearch class="size-[18px] text-secondary" />
          <span class="text-[13px] leading-[18px] text-secondary">
            Browse {{ catalog.length > 0 ? catalog.length : 'available' }} roleplay models…
          </span>
        </div>
        <button
          type="button"
          class="rounded-md border border-outline-variant/40 bg-surface-container px-2.5 py-1 text-[13px] leading-[18px] font-medium text-primary transition-colors hover:bg-surface-container-high"
          @click="libraryOpen = true"
        >
          Library
        </button>
      </div>

      <!-- Manual model id -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Custom model ID</span>
          <span class="text-[11px] text-outline">Any model identifier the provider accepts</span>
        </div>
        <div class="flex items-center gap-2">
          <input
            :value="manualModelId"
            type="text"
            class="w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="e.g. anthropic/claude-3.5-sonnet"
            aria-label="Custom model identifier"
            spellcheck="false"
            @input="manualModelId = ($event.target as HTMLInputElement).value"
          />
          <button
            type="button"
            class="shrink-0 rounded-md border border-outline-variant/40 bg-surface-container px-2.5 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
            :disabled="!manualModelId.trim() || !manualDirty"
            aria-label="Apply custom model identifier"
            @click="applyManualModel()"
          >
            Apply
          </button>
        </div>
      </div>
    </div>

    <!-- Model library modal -->
    <div
      v-if="libraryOpen"
      :data-lk-overlay="libraryToken"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Model library"
      @click.self="libraryOpen = false"
    >
      <div class="flex h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-xl border border-outline-variant/40 bg-surface-container-low sm:h-[70dvh] sm:rounded-xl">
        <div class="flex items-center justify-between border-b border-outline-variant/25 px-4 py-3">
          <div>
            <h3 class="text-[16px] font-semibold text-on-surface">Model Library</h3>
            <p class="text-[11px] text-secondary">
              {{ store.activeProvider?.label ?? 'No provider' }}
              <template v-if="fetchedAt"> · fetched {{ new Date(fetchedAt).toLocaleString() }}</template>
            </p>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="rounded p-1.5 text-on-surface-variant transition-colors hover:text-primary disabled:opacity-50"
              :disabled="refreshing"
              aria-label="Refresh model catalog"
              title="Refresh (bypasses the 24h cache)"
              @click="ensureCatalog(true)"
            >
              <IconRefresh class="size-4" :class="{ 'animate-spin': refreshing }" />
            </button>
            <button
              type="button"
              class="rounded p-1.5 text-on-surface-variant transition-colors hover:text-error"
              aria-label="Close model library"
              @click="libraryOpen = false"
            >
              <IconX class="size-5" />
            </button>
          </div>
        </div>
        <div class="border-b border-outline-variant/25 px-4 py-2.5">
          <div class="relative flex items-center">
            <IconSearch class="absolute left-3 size-4 text-outline" />
            <input
              :value="search"
              type="text"
              class="w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest py-2 pl-9 pr-3 text-[13px] text-on-surface placeholder:text-outline focus:border-primary/60 focus:outline-none"
              placeholder="Search models…"
              aria-label="Search models"
              @input="search = ($event.target as HTMLInputElement).value"
            />
          </div>
        </div>
        <div class="flex-1 overflow-y-auto px-2 py-2">
          <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-secondary">
            <IconLoader class="size-4 animate-spin" /> Loading catalog…
          </div>
          <div v-else-if="!store.activeProviderId" class="py-10 text-center text-[13px] text-secondary">
            Select a provider to browse its models.
          </div>
          <div v-else-if="catalog.length === 0" class="py-10 text-center text-[13px] text-secondary">
            No catalog yet — press refresh to fetch the model list.
          </div>
          <div v-else-if="filteredModels.length === 0" class="py-10 text-center text-[13px] text-secondary">
            No models match “{{ search }}”.
          </div>
          <button
            v-for="model in filteredModels"
            v-else
            :key="model.id"
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-container"
            @click="selectModel(model)"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-[14px] font-medium text-on-surface">{{ model.name }}</span>
                <span
                  v-if="isVisionModel(model)"
                  class="flex shrink-0 items-center gap-1 rounded border border-tertiary-container/40 bg-tertiary-container/15 px-1.5 py-0.5 text-[10px] font-medium text-tertiary-container"
                >
                  <IconEye class="size-3" /> vision
                </span>
              </div>
              <div class="truncate font-mono text-[11px] text-outline">{{ model.id }}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span
                  v-if="contextTag(model)"
                  class="rounded bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] text-secondary"
                >
                  {{ contextTag(model) }} context
                </span>
                <span
                  v-else
                  class="rounded bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] text-outline"
                >
                  context unknown
                </span>
                <span v-if="formatModelPricing(model)" class="font-mono text-[10px] text-secondary">
                  {{ formatModelPricing(model) }}
                </span>
                <span v-else-if="modalityUnknown(model)" class="text-[10px] text-outline">
                  no modality metadata — attach allowed with warning
                </span>
              </div>
            </div>
            <span
              v-if="store.activeModelId === model.id"
              class="flex shrink-0 items-center gap-1 rounded-full bg-primary-container/20 px-2 py-0.5 text-[10px] font-semibold text-primary"
            >
              <IconCheck class="size-3" /> Selected
            </span>
          </button>
        </div>
        <div class="border-t border-outline-variant/25 px-4 py-2 text-[11px] text-outline">
          Catalogs are cached for 24h · manual model IDs always allowed
        </div>
      </div>
    </div>
  </section>
</template>
