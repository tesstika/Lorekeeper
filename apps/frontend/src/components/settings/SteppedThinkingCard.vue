<script setup lang="ts" vapor>
import { OLLAMA_THINKING_MODELS, type OllamaModelStateResponse } from '@lorekeeper/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useOllamaStore } from '@/stores/ollama';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import { formatBytes } from '@/utils/model-format';
import IconBrain from '~icons/lucide/brain';
import IconChevronDown from '~icons/lucide/chevron-down';
import IconDownload from '~icons/lucide/download';
import NumberStepper from '../ui/NumberStepper.vue';
import ToggleSwitch from '../ui/ToggleSwitch.vue';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();
const ui = useUiStore();
const ollama = useOllamaStore();

const enabled = computed(() => store.steppedThinking.enabled);
const maxTokens = computed(() => store.steppedThinking.maxTokens);
const selectedTag = computed(() => store.steppedThinking.modelId);
const directiveDraft = ref(store.steppedThinking.directive);
const directiveOpen = ref(false);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDirectiveSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    store
      .updateSteppedThinking({ directive: directiveDraft.value })
      .then(() => ui.notify('Thinking directive saved', 'success'))
      .catch((error) => ui.notify(describeApiError(error), 'error'));
  }, 600);
}

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});

watch(
  () => store.steppedThinking.directive,
  (value) => {
    if (value !== directiveDraft.value) directiveDraft.value = value;
  },
);

function onDirectiveInput(event: Event): void {
  directiveDraft.value = (event.target as HTMLTextAreaElement).value;
  scheduleDirectiveSave();
}

async function setEnabled(next: boolean): Promise<void> {
  try {
    await store.updateSteppedThinking({ enabled: next });
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

function selectModel(tag: string): void {
  store
    .updateSteppedThinking({ modelId: tag })
    .then(() => ui.notify('Thinking model updated', 'success'))
    .catch((error) => ui.notify(describeApiError(error), 'error'));
}

function setMaxTokens(value: number | null): void {
  const next = value ?? 128;
  store
    .updateSteppedThinking({ maxTokens: Math.min(4096, Math.max(128, next)) })
    .catch((error) => ui.notify(describeApiError(error), 'error'));
}

// Pull state for each curated thinking model (outside the RP whitelist).
const states = computed<Record<string, OllamaModelStateResponse | null>>(() => {
  const map: Record<string, OllamaModelStateResponse | null> = {};
  for (const entry of OLLAMA_THINKING_MODELS) {
    map[entry.tag] = ollama.modelState(entry.tag);
  }
  return map;
});

async function refreshStates(): Promise<void> {
  for (const entry of OLLAMA_THINKING_MODELS) {
    try {
      await ollama.checkModelState(entry.tag);
    } catch {
      // Offline daemon renders as not downloaded.
    }
  }
}

onMounted(() => {
  void refreshStates();
});

const pulls = computed(() =>
  OLLAMA_THINKING_MODELS.map((entry) => ({
    entry,
    state: states.value[entry.tag] ?? null,
    pull: ollama.pullState(entry.tag),
  })),
);

function downloaded(
  pull: { success: boolean } | null,
  state: OllamaModelStateResponse | null,
): boolean {
  return (state?.downloaded ?? false) || (pull?.success ?? false);
}

function percentOf(pull: { completed: number | null; total: number | null }): number {
  if (pull.completed === null || pull.total === null || pull.total <= 0) return 0;
  return Math.min(100, Math.round((pull.completed / pull.total) * 100));
}

async function downloadModel(tag: string): Promise<void> {
  try {
    await ollama.startPull(tag);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
  void refreshStates();
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader
      :icon="IconBrain"
      title="Stepped Thinking"
      caption="Reasoning Helper"
    />
    <div class="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-sm">
      <!-- Master toggle -->
      <div class="flex items-center justify-between gap-3 p-3.5">
        <div class="min-w-0">
          <div class="text-[14px] font-medium leading-5 text-on-surface">Enable Stepped Thinking</div>
          <p class="mt-0.5 text-[11px] leading-3.5 text-secondary">
            A local reasoning model plans the character's reaction before the reply is written. Skipped
            automatically for models that think natively.
          </p>
        </div>
        <ToggleSwitch
          :model-value="enabled"
          label="Enable stepped thinking"
          @update:model-value="setEnabled($event)"
        />
      </div>

      <!-- Curated thinking models -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <span class="text-[14px] font-medium leading-5 text-on-surface">Thinking model</span>
          <span class="text-[11px] text-outline">curated whitelist</span>
        </div>
        <div
          v-for="row in pulls"
          :key="row.entry.tag"
          class="rounded-lg border px-3 py-2.5 transition-colors"
          :class="selectedTag === row.entry.tag ? 'border-primary-container/60 bg-primary-container/10' : 'border-outline-variant/30 bg-surface-container-low'"
        >
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 text-left"
              :aria-pressed="selectedTag === row.entry.tag"
              @click="selectModel(row.entry.tag)"
            >
              <span
                class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                :class="selectedTag === row.entry.tag ? 'border-primary bg-primary' : 'border-outline-variant'"
              >
                <span v-if="selectedTag === row.entry.tag" class="h-1.5 w-1.5 rounded-full bg-on-primary"></span>
              </span>
              <span class="min-w-0">
                <span class="block truncate text-[13px] font-medium text-on-surface">{{ row.entry.label }}</span>
                <span class="block truncate font-mono text-[10px] text-outline">{{ row.entry.tag }}</span>
              </span>
            </button>
            <div v-if="downloaded(row.pull, row.state)" class="flex shrink-0 items-center gap-1 rounded-full bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              Downloaded
              <span v-if="formatBytes(row.state?.sizeBytes ?? null)" class="font-mono text-outline">{{ formatBytes(row.state?.sizeBytes ?? null) }}</span>
            </div>
            <div v-else class="flex shrink-0 items-center gap-2">
              <span class="text-[10px] text-outline">Not downloaded</span>
              <button
                type="button"
                class="flex items-center gap-1 rounded-md border border-outline-variant/40 bg-surface-container px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-surface-container-high"
                :aria-label="`Download ${row.entry.label}`"
                @click="downloadModel(row.entry.tag)"
              >
                <IconDownload class="size-3" />
                Download
              </button>
            </div>
          </div>
          <!-- Live pull progress -->
          <div v-if="row.pull && (row.pull.active || row.pull.error)" class="mt-2 space-y-1">
            <div class="flex items-center justify-between gap-1 text-[10px] leading-3.5">
              <span class="truncate" :class="row.pull.error ? 'text-error' : 'text-secondary'">{{ row.pull.status }}</span>
              <span class="font-mono text-primary">{{ percentOf(row.pull) }}%</span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
              <div
                class="h-full rounded-full"
                :class="row.pull.error ? 'bg-error' : 'bg-primary'"
                :style="{ width: `${percentOf(row.pull)}%` }"
              ></div>
            </div>
            <div class="flex items-center justify-between gap-1">
              <span class="truncate font-mono text-[10px] text-outline">
                {{ formatBytes(row.pull.completed) ?? '…' }} / {{ formatBytes(row.pull.total) ?? '…' }}
              </span>
              <button
                v-if="row.pull.active"
                type="button"
                class="shrink-0 text-[10px] text-on-surface-variant transition-colors hover:text-error"
                :aria-label="`Cancel download of ${row.entry.label}`"
                @click="ollama.cancelPull(row.entry.tag)"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Max thinking tokens -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[14px] font-medium leading-5 text-on-surface">Max thinking tokens</div>
            <p class="mt-0.5 text-[11px] leading-3.5 text-secondary">
              Upper bound on Pass 1 analysis length (num_predict).
            </p>
          </div>
          <NumberStepper
            :model-value="maxTokens"
            :min="128"
            :max="4096"
            :step="128"
            :format="(v) => v.toLocaleString()"
            label="max thinking tokens"
            @update:model-value="setMaxTokens($event)"
          />
        </div>
      </div>

      <!-- Collapsible thinking directive -->
      <div class="space-y-2 p-3.5">
        <button
          type="button"
          class="flex w-full items-center justify-between text-left"
          :aria-expanded="directiveOpen"
          aria-label="Toggle thinking directive"
          @click="directiveOpen = !directiveOpen"
        >
          <span class="text-[14px] font-medium leading-5 text-on-surface">Thinking directive</span>
          <IconChevronDown
            class="size-4.5 text-on-surface-variant transition-transform"
            :class="directiveOpen ? 'rotate-180' : ''"
          />
        </button>
        <div v-if="directiveOpen" class="space-y-1.5">
          <textarea
            :value="directiveDraft"
            rows="5"
            class="w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-[12px] leading-4.5 text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Thinking directive"
            placeholder="Analyze the scene step by step…"
            @input="onDirectiveInput"
          ></textarea>
          <p class="text-[10px] leading-3.5 text-outline">
            Sent to the reasoning model with the recent turns and character context. Saved automatically.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
