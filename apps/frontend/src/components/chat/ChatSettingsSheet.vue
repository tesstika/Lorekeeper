<script setup lang="ts" vapor>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import { useCharactersStore } from '@/stores/characters';
import { useChatsStore } from '@/stores/chats';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const chatsStore = useChatsStore();
const charactersStore = useCharactersStore();
const settingsStore = useSettingsStore();
const ui = useUiStore();
const router = useRouter();

const title = ref('');
const ribbon = ref('');

// Select sentinels — real ids are UUIDs / model ids, so these never collide.
const DEFAULT = '';
const MANUAL = '__manual__';
const NONE = '__none__';
const CUSTOM_BUDGET = '__custom__';

const modelChoice = ref<string>(DEFAULT);
const manualModelId = ref('');
const presetChoice = ref<string>(DEFAULT);
const personaChoice = ref<string>(DEFAULT);
const budgetChoice = ref<string>(DEFAULT);
const budgetValue = ref(8192);

const catalogLoading = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const detail = chatsStore.activeChat;
    if (!detail) return;
    const chat = detail.chat;
    title.value = chat.title;
    ribbon.value = chat.ribbon ?? '';

    // Overrides re-seed from the persisted chat row on every open. personaNone
    // (explicit "play without a persona") is distinct from DEFAULT (follow the
    // global setting) — the select options carry :selected for vapor interop
    // (M1 §4.3: a select :value binding can land before its options exist and
    // is never retried, which left async-loaded persona options unselected).
    modelChoice.value = chat.modelId ?? DEFAULT;
    manualModelId.value = '';
    presetChoice.value = chat.presetId ?? DEFAULT;
    personaChoice.value = chat.personaNone ? NONE : (chat.personaId ?? DEFAULT);
    budgetChoice.value = chat.contextBudgetTokens != null ? CUSTOM_BUDGET : DEFAULT;
    budgetValue.value =
      chat.contextBudgetTokens ?? settingsStore.globalDefaults.contextBudgetTokens;

    void settingsStore.load();
    void charactersStore.loadPersonas();
    void ensureCatalog();
  },
  { immediate: true },
);

/** Loads the model catalog of the chat's effective provider (24 h server cache). */
async function ensureCatalog(): Promise<void> {
  // The effective provider may come from globalDefaults — make sure the
  // settings are loaded before resolving it.
  await settingsStore.load();
  const detail = chatsStore.activeChat;
  const providerId = detail?.chat.providerId ?? settingsStore.globalDefaults.providerId;
  if (!providerId || settingsStore.modelCatalog[providerId]) return;
  catalogLoading.value = true;
  try {
    await settingsStore.fetchProviderModels(providerId);
  } catch {
    // Catalog is optional — manual entry still works.
  } finally {
    catalogLoading.value = false;
  }
}

function shortModel(modelId: string): string {
  const short = modelId.includes('/') ? (modelId.split('/').pop() ?? modelId) : modelId;
  return short.replace(/[-_]/g, ' ');
}

const providerModels = computed(() => {
  const detail = chatsStore.activeChat;
  const providerId = detail?.chat.providerId ?? settingsStore.globalDefaults.providerId;
  return providerId ? (settingsStore.modelCatalog[providerId]?.models ?? []) : [];
});

const defaultModelLabel = computed(() => {
  const modelId = settingsStore.globalDefaults.modelId;
  return modelId ? shortModel(modelId) : 'no model set';
});

const defaultPresetLabel = computed(() => {
  const preset = settingsStore.presets.find((p) => p.id === settingsStore.globalDefaults.presetId);
  return preset?.name ?? 'none';
});

const defaultPersonaLabel = computed(() => {
  const persona = charactersStore.personas.find(
    (p) => p.id === settingsStore.globalDefaults.personaId,
  );
  return persona?.name ?? 'none';
});

async function save(): Promise<void> {
  const detail = chatsStore.activeChat;
  if (!detail) return;
  const chat = detail.chat;

  const modelId =
    modelChoice.value === DEFAULT
      ? null
      : modelChoice.value === MANUAL
        ? manualModelId.value.trim() || null
        : modelChoice.value;
  const presetId = presetChoice.value === DEFAULT ? null : presetChoice.value;
  // personaNone is the explicit "None — play without a persona" override;
  // personaId stays a strict id-or-null (never '' — the personas FK rejects it).
  const personaNone = personaChoice.value === NONE;
  const personaId = personaNone || personaChoice.value === DEFAULT ? null : personaChoice.value;
  const contextBudgetTokens = budgetChoice.value === CUSTOM_BUDGET ? budgetValue.value : null;

  try {
    // updateChat returns null on failure (the store toasts the error) — keep
    // the sheet open so the user can retry.
    const updated = await chatsStore.updateChat(chat.id, {
      ...(title.value.trim() !== chat.title && title.value.trim().length > 0
        ? { title: title.value.trim() }
        : {}),
      ...(ribbon.value !== (chat.ribbon ?? '') ? { ribbon: ribbon.value } : {}),
      ...(modelId !== (chat.modelId ?? null) ? { modelId } : {}),
      ...(presetId !== (chat.presetId ?? null) ? { presetId } : {}),
      ...(personaId !== (chat.personaId ?? null) || personaNone !== chat.personaNone
        ? { personaId, personaNone }
        : {}),
      ...(contextBudgetTokens !== (chat.contextBudgetTokens ?? null)
        ? { contextBudgetTokens }
        : {}),
    });
    if (!updated) return;
    emit('close');
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

async function toggleArchive(): Promise<void> {
  const chat = chatsStore.activeChat?.chat;
  if (!chat) return;
  await chatsStore.updateChat(chat.id, {
    status: chat.status === 'archived' ? 'in_progress' : 'archived',
  });
  emit('close');
}

async function removeChat(): Promise<void> {
  const chat = chatsStore.activeChat?.chat;
  if (!chat) return;
  const removed = await chatsStore.removeChat(chat.id);
  if (removed) {
    emit('close');
    await router.push('/chats');
  }
}
</script>

<template>
  <!-- Caller-side gate: see NewChatSheet (vapor interop slot leak). -->
  <BottomSheet v-if="props.open" :open="true" title="Chronicle Settings" @close="emit('close')">
    <label class="block text-[12px] font-medium text-on-surface-variant" for="chat-title">Title</label>
    <input
      id="chat-title"
      :value="title"
      type="text"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @input="title = ($event.target as HTMLInputElement).value"
    >

    <label class="mt-3 block text-[12px] font-medium text-on-surface-variant" for="chat-ribbon">Context ribbon</label>
    <input
      id="chat-ribbon"
      :value="ribbon"
      type="text"
      placeholder="Chapter IV: The Midnight Seal"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @input="ribbon = ($event.target as HTMLInputElement).value"
    >

    <!-- Per-chat overrides (M4): each falls back to the global default. -->
    <p class="mt-5 text-[11px] font-semibold uppercase tracking-wider text-secondary">Overrides</p>

    <label class="mt-3 block text-[12px] font-medium text-on-surface-variant" for="override-model">Model</label>
    <select
      id="override-model"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @change="modelChoice = ($event.target as HTMLSelectElement).value"
    >
      <option :value="DEFAULT" :selected="modelChoice === DEFAULT">Default from settings ({{ defaultModelLabel }})</option>
      <option :value="MANUAL" :selected="modelChoice === MANUAL">Manual model id…</option>
      <option v-if="catalogLoading" disabled>loading catalog…</option>
      <option
        v-for="model in providerModels"
        :key="model.id"
        :value="model.id"
        :selected="modelChoice === model.id"
      >
        {{ model.name }}
      </option>
    </select>
    <input
      v-if="modelChoice === MANUAL"
      :value="manualModelId"
      type="text"
      aria-label="Manual model identifier"
      placeholder="e.g. anthropic/claude-3.5-sonnet"
      spellcheck="false"
      class="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary/60"
      @input="manualModelId = ($event.target as HTMLInputElement).value"
    >

    <label class="mt-3 block text-[12px] font-medium text-on-surface-variant" for="override-preset">Preset</label>
    <select
      id="override-preset"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @change="presetChoice = ($event.target as HTMLSelectElement).value"
    >
      <option :value="DEFAULT" :selected="presetChoice === DEFAULT">Default from settings ({{ defaultPresetLabel }})</option>
      <option
        v-for="preset in settingsStore.presets"
        :key="preset.id"
        :value="preset.id"
        :selected="presetChoice === preset.id"
      >
        {{ preset.name }}
      </option>
    </select>

    <label class="mt-3 block text-[12px] font-medium text-on-surface-variant" for="override-persona">Persona</label>
    <select
      id="override-persona"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @change="personaChoice = ($event.target as HTMLSelectElement).value"
    >
      <option :value="DEFAULT" :selected="personaChoice === DEFAULT">Default from settings ({{ defaultPersonaLabel }})</option>
      <option :value="NONE" :selected="personaChoice === NONE">None — play without a persona</option>
      <option
        v-for="persona in charactersStore.personas"
        :key="persona.id"
        :value="persona.id"
        :selected="personaChoice === persona.id"
      >
        {{ persona.name }}
      </option>
    </select>

    <label class="mt-3 block text-[12px] font-medium text-on-surface-variant" for="override-budget">Context budget</label>
    <select
      id="override-budget"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @change="budgetChoice = ($event.target as HTMLSelectElement).value"
    >
      <option :value="DEFAULT" :selected="budgetChoice === DEFAULT">Default from settings ({{ settingsStore.globalDefaults.contextBudgetTokens }} tokens)</option>
      <option :value="CUSTOM_BUDGET" :selected="budgetChoice === CUSTOM_BUDGET">Custom budget…</option>
    </select>
    <div v-if="budgetChoice === CUSTOM_BUDGET" class="mt-2 flex items-center gap-3">
      <input
        :value="budgetValue"
        type="range"
        min="1024"
        max="200000"
        step="1024"
        aria-label="Context budget in tokens"
        class="lk-range flex-1"
        @input="budgetValue = Number(($event.target as HTMLInputElement).value)"
      >
      <input
        :value="budgetValue"
        type="number"
        min="1024"
        max="1000000"
        aria-label="Context budget tokens (number)"
        class="w-24 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 py-1.5 text-right font-mono text-xs text-on-surface outline-none focus:border-primary/60"
        @input="budgetValue = Number(($event.target as HTMLInputElement).value)"
      >
    </div>

    <div class="mt-5 flex flex-col gap-2">
      <button
        type="button"
        class="w-full rounded-full bg-primary-container py-2.5 text-[13px] font-semibold text-on-primary-container transition active:scale-95"
        @click="save()"
      >Save changes</button>
      <button
        type="button"
        class="w-full rounded-full border border-outline-variant/40 py-2.5 text-[13px] text-on-surface transition-colors hover:border-primary/50"
        @click="toggleArchive()"
      >
        {{ chatsStore.activeChat?.chat.status === 'archived' ? 'Move back to In Progress' : 'Archive chronicle' }}
      </button>
      <button
        type="button"
        class="w-full rounded-full border border-error/40 py-2.5 text-[13px] text-error transition-colors hover:bg-error/10"
        @click="removeChat()"
      >Delete chronicle</button>
    </div>
  </BottomSheet>
</template>
