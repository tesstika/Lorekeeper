<script setup lang="ts" vapor>
import { computed, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import IconBookmarkAdd from '~icons/lucide/bookmark';
import IconBookmark from '~icons/lucide/bookmark';
import IconCheck from '~icons/lucide/check';
import IconEdit from '~icons/lucide/pen-tool';
import IconSave from '~icons/lucide/save';
import IconSliders from '~icons/lucide/sliders-horizontal';
import IconDelete from '~icons/lucide/trash-2';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();
const ui = useUiStore();

const showSaveAsNew = ref(false);
const confirmingDeleteId = ref<string | null>(null);

const presets = computed(() => store.presets);
const selectedId = computed(() => store.activePresetId);

function tags(presetId: string): string[] {
  const preset = presets.value.find((p) => p.id === presetId);
  if (!preset) return [];
  return [
    `Temp ${preset.temperature.toFixed(2)}`,
    `Top P ${preset.topP.toFixed(2)}`,
    `Tokens ${preset.maxTokens >= 1000 ? `${Math.round(preset.maxTokens / 1000)}k` : preset.maxTokens}`,
  ];
}

function selectPreset(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const id = value === '' ? null : value;
  store
    .selectPreset(id)
    .then(() => {
      ui.notify(id ? 'Preset loaded' : 'Preset deselected', 'success');
    })
    .catch((error) => ui.notify(describeApiError(error), 'error'));
}

function setDefault(id: string): void {
  store.setDefaultPreset(id).catch((error) => ui.notify(describeApiError(error), 'error'));
}

function updateCurrent(): void {
  store.updateCurrentPreset().catch((error) => ui.notify(describeApiError(error), 'error'));
}

function removePreset(id: string): void {
  if (confirmingDeleteId.value !== id) {
    confirmingDeleteId.value = id;
    setTimeout(() => {
      if (confirmingDeleteId.value === id) confirmingDeleteId.value = null;
    }, 3000);
    return;
  }
  confirmingDeleteId.value = null;
  store.deletePreset(id).catch((error) => ui.notify(describeApiError(error), 'error'));
}

function saveAsNew(): void {
  const name = store.newPresetName.trim();
  if (!name) {
    ui.notify('Give the preset a name first', 'error');
    return;
  }
  store
    .saveWorkingAsNew(name)
    .then(() => {
      store.newPresetName = '';
      showSaveAsNew.value = false;
    })
    .catch((error) => ui.notify(describeApiError(error), 'error'));
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader
      :icon="IconBookmark"
      title="Saved Generation Presets"
      :caption="`${presets.length} Profile${presets.length === 1 ? '' : 's'}`"
    />

    <!-- Preset selector dropdown -->
    <div class="flex items-center gap-2 px-1">
      <label for="preset-selector" class="text-[11px] font-medium tracking-wide text-secondary">Active preset</label>
      <div class="relative flex-1">
      <select
        id="preset-selector"
        class="w-full appearance-none rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-[13px] text-on-surface focus:border-primary/60 focus:outline-none"
        aria-label="Select generation preset"
        @change="selectPreset($event)"
      >
        <option value="" :selected="selectedId === null">— None (draft only) —</option>
        <option v-for="preset in presets" :key="preset.id" :value="preset.id" :selected="preset.id === selectedId">
          {{ preset.name }}{{ preset.isDefault ? ' (default)' : '' }}
        </option>
      </select>
        <IconSliders class="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-outline" />
      </div>
      <button
        type="button"
        class="rounded-md border border-outline-variant/40 bg-surface-container px-2.5 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
        :disabled="!selectedId"
        aria-label="Update the current preset with the tuned values"
        @click="updateCurrent()"
      >
        <span class="flex items-center gap-1"><IconSave class="size-3.5" /> Update Current</span>
      </button>
    </div>

    <div class="space-y-2.5">
      <!-- Preset cards -->
      <div
        v-for="preset in presets"
        :key="preset.id"
        class="relative overflow-hidden rounded-xl p-4"
        :class="
          preset.id === selectedId
            ? 'border-2 border-primary-container/60 bg-surface-container-high shadow-[0_4px_20px_-2px_rgba(192,132,252,0.18)]'
            : 'border border-outline-variant/40 bg-surface-container'
        "
      >
        <div class="flex items-start justify-between">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-[16px] font-semibold leading-5.5 text-on-surface">{{ preset.name }}</h3>
              <span
                v-if="preset.id === selectedId"
                class="rounded-full bg-primary-container px-2 py-0.5 text-[11px] font-semibold tracking-wide text-on-primary"
              >
                Selected
              </span>
              <span
                v-if="preset.isDefault"
                class="flex items-center gap-1 rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] font-medium text-primary"
              >
                <IconCheck class="size-3" /> Default
              </span>
            </div>
            <p v-if="preset.description" class="text-[11px] leading-3.5 text-secondary">{{ preset.description }}</p>
          </div>
          <div class="flex items-center gap-1">
            <button
              v-if="!preset.isDefault"
              type="button"
              class="rounded-lg bg-surface-container p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
              title="Set as default"
              :aria-label="`Set ${preset.name} as default`"
              @click="setDefault(preset.id)"
            >
              <IconCheck class="size-4" />
            </button>
            <button
              type="button"
              class="p-1 text-on-surface-variant transition-colors"
              :class="confirmingDeleteId === preset.id ? 'text-error' : 'hover:text-error'"
              :title="confirmingDeleteId === preset.id ? 'Tap again to confirm' : 'Delete preset'"
              :aria-label="confirmingDeleteId === preset.id ? `Confirm deleting ${preset.name}` : `Delete ${preset.name}`"
              @click="removePreset(preset.id)"
            >
              <IconDelete class="size-4" />
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5 pt-3">
          <span
            v-for="tag in tags(preset.id)"
            :key="tag"
            class="rounded border border-outline-variant/30 bg-surface-container px-2 py-0.5 font-mono text-[11px] text-primary"
          >
            {{ tag }}
          </span>
        </div>
        <div
          v-if="confirmingDeleteId === preset.id"
          class="mt-2 flex items-center justify-between rounded-lg border border-error/50 bg-error-container/30 px-3 py-2 text-[11px] text-on-error-container"
        >
          Delete “{{ preset.name }}”? This cannot be undone.
          <button
            type="button"
            class="rounded-md border border-error/60 px-2 py-1 font-medium text-error"
            aria-label="Confirm delete preset"
            @click="removePreset(preset.id)"
          >
            Confirm
          </button>
        </div>
      </div>

      <!-- Save current as new -->
      <button
        v-if="!showSaveAsNew"
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-low/40 py-3 text-[13px] leading-4.5 font-medium text-secondary transition-all hover:border-primary hover:bg-surface-container-low hover:text-primary"
        aria-label="Save current values as a new preset"
        @click="showSaveAsNew = true"
      >
        <IconBookmarkAdd class="size-4.5" />
        + Save Current as New Preset
      </button>
      <div
        v-else
        class="flex items-center gap-2 rounded-xl border border-outline-variant/50 bg-surface-container-low p-3"
      >
        <input
          :value="store.newPresetName"
          type="text"
          class="w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 text-[13px] text-on-surface placeholder:text-outline focus:border-primary/60 focus:outline-none"
          placeholder="Preset name (e.g. Novelist's Flow)"
          aria-label="New preset name"
          @input="store.newPresetName = ($event.target as HTMLInputElement).value"
          @keydown.enter="saveAsNew()"
        />
        <button
          type="button"
          class="shrink-0 rounded-md border border-outline-variant/40 bg-surface-container px-2.5 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
          :disabled="!store.newPresetName.trim()"
          aria-label="Create preset"
          @click="saveAsNew()"
        >
          <IconEdit class="size-3.5" /> Create
        </button>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-2 text-[12px] text-secondary transition-colors hover:text-on-surface"
          aria-label="Cancel new preset"
          @click="showSaveAsNew = false"
        >
          Cancel
        </button>
      </div>
    </div>
  </section>
</template>
