<script setup lang="ts" vapor>
import type { Character, Persona } from '@lorekeeper/shared';
import { computed, ref } from 'vue';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import { useCharactersStore } from '@/stores/characters';
import { useChatsStore } from '@/stores/chats';
import { useSettingsStore } from '@/stores/settings';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [chatId: string] }>();

const charactersStore = useCharactersStore();
const chatsStore = useChatsStore();
const settingsStore = useSettingsStore();

const step = ref<'character' | 'persona'>('character');
const selectedCharacter = ref<Character | null>(null);
const selectedPersonaId = ref<string | null>(null);
const modelOverride = ref('');
const creating = ref(false);

const personas = computed(() => charactersStore.personas);
const defaultPersonaId = computed(() => personas.value.find((p) => p.isDefault)?.id ?? null);
const defaultModelId = computed(() => settingsStore.globalDefaults.modelId ?? '');

function pickCharacter(character: Character): void {
  selectedCharacter.value = character;
  selectedPersonaId.value = defaultPersonaId.value;
  modelOverride.value = '';
  step.value = 'persona';
}

function backToCharacters(): void {
  step.value = 'character';
  selectedCharacter.value = null;
}

async function create(): Promise<void> {
  if (!selectedCharacter.value || creating.value) return;
  creating.value = true;
  const detail = await chatsStore.createChat({
    characterId: selectedCharacter.value.id,
    personaId: selectedPersonaId.value,
    ...(modelOverride.value.trim().length > 0 ? { modelId: modelOverride.value.trim() } : {}),
  });
  creating.value = false;
  if (detail) {
    emit('created', detail.chat.id);
    emit('close');
    step.value = 'character';
    selectedCharacter.value = null;
  }
}
</script>

<template>
  <!-- Caller-side gate: vapor interop leaks slot content past the child's own
       v-if, so the sheet must not be created at all while closed. -->
  <BottomSheet v-if="props.open" :open="true" title="Begin a New Tale" @close="emit('close')">
    <template v-if="step === 'character'">
      <p class="mb-3 text-[12px] text-on-surface-variant">Choose your companion for this chronicle.</p>
      <div v-if="charactersStore.characters.length === 0" class="py-6 text-center text-[13px] text-outline">
        No characters yet — create one on the Characters page.
      </div>
      <ul v-else class="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
        <li v-for="character in charactersStore.characters" :key="character.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-low p-2 text-left transition-colors hover:border-primary/40"
            @click="pickCharacter(character)"
          >
            <span class="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container ring-1 ring-outline-variant/30">
              <img v-if="character.avatarPath" :src="character.avatarPath" :alt="character.name" class="size-full object-cover" />
              <span v-else class="text-[13px] font-bold text-secondary">{{ character.name.slice(0, 1).toUpperCase() }}</span>
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[14px] font-semibold text-on-surface">{{ character.name }}</span>
              <span v-if="character.tagline" class="block truncate text-[11px] text-outline">{{ character.tagline }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>

    <template v-else-if="selectedCharacter">
      <div class="mb-3 flex items-center justify-between">
        <p class="text-[12px] text-on-surface-variant">Who are you in this tale?</p>
        <button
          type="button"
          class="text-[12px] text-secondary underline-offset-2 hover:text-primary hover:underline"
          @click="backToCharacters"
        >Change character</button>
      </div>
      <div class="space-y-1.5">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-colors"
          :class="selectedPersonaId === null ? 'border-primary/50 bg-primary/10' : 'border-outline-variant/20 bg-surface-container-low'"
          @click="selectedPersonaId = null"
        >
          <span class="text-[14px] text-on-surface">No persona</span>
          <span v-if="selectedPersonaId === null" class="text-[11px] font-medium text-primary">Selected</span>
        </button>
        <button
          v-for="persona in personas"
          :key="persona.id"
          type="button"
          class="flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-colors"
          :class="selectedPersonaId === persona.id ? 'border-primary/50 bg-primary/10' : 'border-outline-variant/20 bg-surface-container-low'"
          @click="selectedPersonaId = persona.id"
        >
          <span class="min-w-0">
            <span class="block truncate text-[14px] text-on-surface">{{ persona.name }}</span>
            <span v-if="persona.isDefault" class="text-[10px] text-primary">Default</span>
          </span>
          <span v-if="selectedPersonaId === persona.id" class="text-[11px] font-medium text-primary">Selected</span>
        </button>
      </div>

      <label class="mt-4 block text-[12px] font-medium text-on-surface-variant" for="new-chat-model">
        Model override (optional)
      </label>
      <input
        id="new-chat-model"
        :value="modelOverride"
        type="text"
        :placeholder="defaultModelId ? `Default: ${defaultModelId}` : 'Provider model id'"
        class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
        @input="modelOverride = ($event.target as HTMLInputElement).value"
      >

      <button
        type="button"
        class="mt-5 w-full rounded-full bg-primary py-3 text-[14px] font-semibold text-on-primary shadow-lg transition active:scale-95 disabled:opacity-50"
        :disabled="creating"
        @click="create()"
      >
        {{ creating ? 'Opening the chronicle…' : 'Begin the tale' }}
      </button>
    </template>
  </BottomSheet>
</template>
