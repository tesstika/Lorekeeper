<script setup lang="ts" vapor>
import { PROMPT_VARIABLES, type PromptVariable } from '@lorekeeper/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import IconFileText from '~icons/lucide/file-text';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();
const ui = useUiStore();

const systemTemplate = ref('');
const postHistoryInstructions = ref('');
const systemEl = ref<HTMLTextAreaElement | null>(null);
const phiEl = ref<HTMLTextAreaElement | null>(null);

let syncSource: string | null = null;
watch(
  () => store.promptTemplate,
  (value) => {
    const signature = `${value.systemTemplate}\u0000${value.postHistoryInstructions}`;
    if (signature === syncSource) return;
    systemTemplate.value = value.systemTemplate;
    postHistoryInstructions.value = value.postHistoryInstructions;
    syncSource = signature;
  },
  { immediate: true },
);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const patch = {
      systemTemplate: systemTemplate.value,
      postHistoryInstructions: postHistoryInstructions.value,
    };
    syncSource = `${patch.systemTemplate}\u0000${patch.postHistoryInstructions}`;
    store.updatePromptTemplate(patch).then(
      () => {
        lastSavedAt.value = new Date();
      },
      (error) => ui.notify(describeApiError(error), 'error'),
    );
  }, 600);
}

const lastSavedAt = ref<Date | null>(null);
const savedLabel = computed(() =>
  lastSavedAt.value ? `Saved ${lastSavedAt.value.toLocaleTimeString()}` : '',
);

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});

function onSystemInput(event: Event): void {
  systemTemplate.value = (event.target as HTMLTextAreaElement).value;
  scheduleSave();
}

function onPhiInput(event: Event): void {
  postHistoryInstructions.value = (event.target as HTMLTextAreaElement).value;
  scheduleSave();
}

function insertVariable(variable: PromptVariable): void {
  const snippet = `{{${variable}}}`;
  const el = systemEl.value;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.setRangeText(snippet, start, end, 'end');
  systemTemplate.value = el.value;
  scheduleSave();
  el.focus();
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader :icon="IconFileText" title="Prompt Template" caption="System & PHI" />
    <div class="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-sm">
      <!-- System template -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <span class="text-[16px] font-semibold leading-5.5 text-on-surface">System prompt template</span>
          <span v-if="savedLabel" class="text-[11px] text-emerald-300">{{ savedLabel }}</span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="variable in PROMPT_VARIABLES"
            :key="variable"
            type="button"
            class="rounded border border-outline-variant/40 bg-surface-container-low px-2 py-0.5 font-mono text-[11px] text-secondary transition-colors hover:border-primary/60 hover:text-primary"
            :aria-label="`Insert variable ${variable}`"
            @click="insertVariable(variable)"
          >
            {{ '\u007B\u007B' + variable + '\u007D\u007D' }}
          </button>
        </div>
        <textarea
          ref="systemEl"
          rows="12"
          class="w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 font-mono text-xs leading-5 text-on-surface placeholder:text-outline focus:border-primary/60 focus:outline-none"
          :value="systemTemplate"
          placeholder="System prompt template — variables like {{char}} and {{user}} are substituted per chat."
          aria-label="System prompt template"
          spellcheck="false"
          @input="onSystemInput"
        ></textarea>
        <p class="text-[11px] leading-3.5 text-outline">
          Sections written as <span class="font-mono">{{ '\u007B\u007B#tagline\u007D\u007D…\u007B\u007B/tagline\u007D\u007D' }}</span> are omitted when empty.
        </p>
      </div>

      <!-- Post-history instructions -->
      <div class="space-y-2 p-3.5">
        <span class="text-[16px] font-semibold leading-5.5 text-on-surface">Post-history instructions</span>
        <p class="text-[11px] leading-3.5 text-secondary">
          Appended as the final system message after the chat history (the “jailbreak” slot).
        </p>
        <textarea
          ref="phiEl"
          rows="4"
          class="w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 font-mono text-xs leading-5 text-on-surface placeholder:text-outline focus:border-primary/60 focus:outline-none"
          :value="postHistoryInstructions"
          placeholder="[System note: …]"
          aria-label="Post-history instructions"
          spellcheck="false"
          @input="onPhiInput"
        ></textarea>
      </div>
    </div>
  </section>
</template>
