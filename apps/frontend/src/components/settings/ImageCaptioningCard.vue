<script setup lang="ts" vapor>
import { OLLAMA_CAPTIONER_MODEL } from '@lorekeeper/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useOllamaStore } from '@/stores/ollama';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import { formatBytes } from '@/utils/model-format';
import IconCheck from '~icons/lucide/check';
import IconChevronDown from '~icons/lucide/chevron-down';
import IconDownload from '~icons/lucide/download';
import IconImage from '~icons/lucide/image';
import ToggleSwitch from '../ui/ToggleSwitch.vue';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();
const ui = useUiStore();
const ollama = useOllamaStore();

const enabled = computed(() => store.imageCaptioning.enabled);
const promptOpen = ref(false);
const promptDraft = ref(store.imageCaptioning.prompt);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePromptSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    store
      .updateImageCaptioning({ prompt: promptDraft.value })
      .then(() => ui.notify('Captioning prompt saved', 'success'))
      .catch((error) => ui.notify(describeApiError(error), 'error'));
  }, 600);
}

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});

watch(
  () => store.imageCaptioning.prompt,
  (value) => {
    if (value !== promptDraft.value) promptDraft.value = value;
  },
);

function onPromptInput(event: Event): void {
  promptDraft.value = (event.target as HTMLTextAreaElement).value;
  schedulePromptSave();
}

async function setEnabled(next: boolean): Promise<void> {
  try {
    await store.updateImageCaptioning({ enabled: next });
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

// Moondream2 pull state (ad-hoc tag — outside the curated RP whitelist).
const pull = computed(() => ollama.pullState(OLLAMA_CAPTIONER_MODEL));
const state = computed(() => ollama.modelState(OLLAMA_CAPTIONER_MODEL));
const downloaded = computed(
  () => (state.value?.downloaded ?? false) || (pull.value?.success ?? false),
);

async function refreshModelState(): Promise<void> {
  try {
    await ollama.checkModelState(OLLAMA_CAPTIONER_MODEL);
  } catch {
    // Offline daemon renders as "Not downloaded" + the helper text explains.
  }
}

onMounted(() => {
  void refreshModelState();
});

watch(
  () => pull.value?.success,
  (done) => {
    if (done) void refreshModelState();
  },
);

const percent = computed(() => {
  const state0 = pull.value;
  if (!state0 || state0.completed === null || state0.total === null || state0.total <= 0) return 0;
  return Math.min(100, Math.round((state0.completed / state0.total) * 100));
});

async function downloadModel(): Promise<void> {
  try {
    await ollama.startPull(OLLAMA_CAPTIONER_MODEL);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

const sizeLabel = computed(() => formatBytes(state.value?.sizeBytes ?? null));
</script>

<template>
  <section class="space-y-2">
    <SectionHeader
      :icon="IconImage"
      title="Image Captioning"
      caption="Vision Helper"
    />
    <div class="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-sm">
      <!-- Master toggle -->
      <div class="flex items-center justify-between gap-3 p-3.5">
        <div class="min-w-0">
          <div class="text-[14px] font-medium leading-5 text-on-surface">Local Image Captioning</div>
          <p class="mt-0.5 text-[11px] leading-3.5 text-secondary">
            Uses a local lightweight vision model to describe images for text-only models (both
            local Ollama and OpenRouter/UnoRouter).
          </p>
        </div>
        <ToggleSwitch
          :model-value="enabled"
          label="Local image captioning"
          @update:model-value="setEnabled($event)"
        />
      </div>

      <!-- Vision model info -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[14px] font-medium leading-5 text-on-surface">Moondream2 (Ollama library)</div>
            <div class="truncate font-mono text-[11px] text-outline">{{ OLLAMA_CAPTIONER_MODEL }}</div>
          </div>
          <template v-if="pull && pull.active">
            <span class="shrink-0 font-mono text-[10px] text-primary">{{ percent }}%</span>
          </template>
          <div v-else-if="downloaded" class="flex shrink-0 items-center gap-1 rounded-full bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            <IconCheck class="size-3" /> Downloaded
            <span v-if="sizeLabel" class="font-mono text-outline">{{ sizeLabel }}</span>
          </div>
        </div>

        <!-- Live pull progress -->
        <div v-if="pull && pull.active" class="space-y-1">
          <div class="flex items-center justify-between gap-1 text-[10px] leading-3.5">
            <span class="truncate" :class="pull.error ? 'text-error' : 'text-secondary'">{{ pull.status }}</span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <div
              class="h-full rounded-full"
              :class="pull.error ? 'bg-error' : 'bg-primary'"
              :style="{ width: `${percent}%` }"
            ></div>
          </div>
          <div class="flex items-center justify-between gap-1">
            <span class="truncate font-mono text-[10px] text-outline">
              {{ formatBytes(pull.completed) ?? '…' }} / {{ formatBytes(pull.total) ?? '…' }}
            </span>
            <button
              type="button"
              class="shrink-0 text-[10px] text-on-surface-variant transition-colors hover:text-error"
              aria-label="Cancel vision model download"
              @click="ollama.cancelPull(OLLAMA_CAPTIONER_MODEL)"
            >
              Cancel
            </button>
          </div>
        </div>
        <div v-else-if="!downloaded" class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-outline">Not downloaded — required only when captioning is on.</span>
          <button
            type="button"
            class="flex shrink-0 items-center gap-1 rounded-md border border-outline-variant/40 bg-surface-container px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-surface-container-high"
            aria-label="Download Moondream2 vision model"
            @click="downloadModel()"
          >
            <IconDownload class="size-3" />
            Download
          </button>
        </div>
      </div>

      <!-- Collapsible custom captioning prompt -->
      <div class="space-y-2 p-3.5">
        <button
          type="button"
          class="flex w-full items-center justify-between text-left"
          :aria-expanded="promptOpen"
          aria-label="Toggle custom captioning prompt"
          @click="promptOpen = !promptOpen"
        >
          <span class="text-[14px] font-medium leading-5 text-on-surface">Captioning prompt</span>
          <IconChevronDown
            class="size-4.5 text-on-surface-variant transition-transform"
            :class="promptOpen ? 'rotate-180' : ''"
          />
        </button>
        <div v-if="promptOpen" class="space-y-1.5">
          <textarea
            :value="promptDraft"
            rows="4"
            class="w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-[12px] leading-4.5 text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Custom captioning prompt"
            placeholder="Describe this image in rich detail…"
            @input="onPromptInput"
          ></textarea>
          <p class="text-[10px] leading-3.5 text-outline">
            Sent to the vision model with every uncaptioned image. Saved automatically.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
