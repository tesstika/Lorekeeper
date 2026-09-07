<script setup lang="ts" vapor>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, api } from '@/api';
import CharacterCard from '@/components/characters/CharacterCard.vue';
import ImportCardButton from '@/components/characters/ImportCardButton.vue';
import PersonaCard from '@/components/characters/PersonaCard.vue';
import BottomNav from '@/components/ui/BottomNav.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import { useCharactersStore } from '@/stores/characters';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import IconBook from '~icons/lucide/book-open-text';
import IconPlus from '~icons/lucide/plus';
import IconSearch from '~icons/lucide/search';
import IconCheckSquare from '~icons/lucide/square-check-big';
import IconTrash from '~icons/lucide/trash-2';
import IconX from '~icons/lucide/x';

const router = useRouter();
const store = useCharactersStore();
const ui = useUiStore();

onMounted(() => {
  void store.loadCharacters();
  void store.loadPersonas();
});

type Tab = 'characters' | 'personas';
const tab = ref<Tab>('characters');

const searchOpen = ref(false);
const search = ref('');

const characterCount = computed(() => store.characters.length);
const personaCount = computed(() => store.personas.length);

function matchesSearch(text: string): boolean {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return true;
  return text.toLowerCase().includes(needle);
}

const visibleCharacters = computed(() =>
  store.characters.filter((c) => matchesSearch(`${c.name} ${c.tagline ?? ''} ${c.tags.join(' ')}`)),
);
const visiblePersonas = computed(() =>
  store.personas.filter((p) => matchesSearch(`${p.name} ${p.description}`)),
);

// -- selection mode (batch actions) -------------------------------------------
const selectionMode = ref(false);
const selectedIds = ref<string[]>([]);

function toggleSelection(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((existing) => existing !== id)
    : [...selectedIds.value, id];
}

function exitSelection(): void {
  selectionMode.value = false;
  selectedIds.value = [];
}

async function deleteSelected(): Promise<void> {
  const ids = [...selectedIds.value];
  const label = ids.length === 1 ? 'character' : `${ids.length} characters`;
  const accepted = await ui.confirm({
    title: `Delete selected ${label}?`,
    message: 'Chats referencing a selected character are deleted with it. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!accepted) return;
  let blocked = 0;
  for (const id of ids) {
    try {
      await api.deleteCharacter(id, true);
      store.characters = store.characters.filter((c) => c.id !== id);
    } catch (error) {
      blocked += 1;
      if (!(error instanceof ApiError)) ui.notify(describeApiError(error), 'error');
    }
  }
  selectedIds.value = [];
  if (blocked > 0) {
    ui.notify(`${blocked} character${blocked === 1 ? '' : 's'} could not be deleted`, 'error');
  } else {
    ui.notify('Selection deleted', 'info');
  }
  if (store.characters.length === 0) exitSelection();
}

function exportSelected(): void {
  for (const id of selectedIds.value) {
    api.exportCharacterCard(id, 'v2');
  }
  ui.notify(
    `Exporting ${selectedIds.value.length} card${selectedIds.value.length === 1 ? '' : 's'} as V2 JSON`,
    'info',
  );
}

// -- per-card flows ------------------------------------------------------------

function openCharacter(id: string): void {
  if (selectionMode.value) {
    toggleSelection(id);
    return;
  }
  void router.push(`/characters/${id}`);
}

function openPersona(id: string): void {
  void router.push(`/personas/${id}`);
}

function newEntity(): void {
  void router.push(tab.value === 'characters' ? '/characters/new' : '/personas/new');
}

async function deleteCharacter(id: string): Promise<void> {
  await store.removeCharacter(id);
}

async function deletePersona(id: string): Promise<void> {
  await store.removePersona(id);
}

function exportCard(id: string): void {
  api.exportCharacterCard(id, 'v2');
  ui.notify('Exporting card as SillyTavern V2 JSON', 'info');
}

function imported(id: string): void {
  void router.push(`/characters/${id}`);
}

async function setDefaultPersona(id: string): Promise<void> {
  try {
    await store.setDefaultPersona(id);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value;
  if (!searchOpen.value) search.value = '';
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-[520px] flex-col border-x border-outline-variant/20 bg-surface pb-28">
    <header class="sticky top-0 z-40 flex items-center justify-between bg-surface/85 px-5 pb-3 pt-9 backdrop-blur-md">
      <div class="flex items-center gap-2">
        <IconBook class="size-6 text-primary" />
        <h1 class="text-[22px] font-bold tracking-tight text-on-surface">Characters</h1>
      </div>
      <div class="flex items-center gap-1.5">
        <ImportCardButton @imported="imported" />
        <button
          type="button"
          :aria-label="searchOpen ? 'Close search' : 'Search characters'"
          class="p-1.5 text-secondary transition-colors hover:text-primary"
          @click="toggleSearch"
        >
          <IconX v-if="searchOpen" class="size-5" />
          <IconSearch v-else class="size-5" />
        </button>
      </div>
    </header>

    <div v-if="searchOpen" class="px-5 pb-2">
      <input
        type="text"
        :value="search"
        aria-label="Filter by name, tagline or tags"
        placeholder="Filter by name, tag or tagline…"
        class="w-full rounded-full border border-outline-variant/40 bg-surface-container-lowest px-4 py-2 text-[13px] text-on-surface outline-none placeholder:text-outline focus:border-primary/60"
        @input="search = ($event.target as HTMLInputElement).value"
      />
    </div>

    <section aria-label="Entity filter" class="flex justify-center px-5 pb-1">
      <div class="flex w-full items-center rounded-full border border-outline-variant/30 bg-surface-container-lowest p-1 shadow-inner">
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all"
          :class="tab === 'characters' ? 'bg-surface-container-high text-primary shadow-sm' : 'text-secondary hover:text-on-surface'"
          aria-label="Show characters tab"
          @click="tab = 'characters'"
        >
          <span class="inline-block h-1.5 w-1.5 rounded-full" :class="tab === 'characters' ? 'bg-primary' : 'bg-transparent'" />
          <span>Characters</span>
          <span
            class="ml-1 rounded-full px-1.5 py-0.5 text-[11px]"
            :class="tab === 'characters' ? 'bg-surface-container text-secondary' : 'bg-surface-container-low text-secondary'"
          >
            {{ characterCount }}
          </span>
        </button>
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all"
          :class="tab === 'personas' ? 'bg-surface-container-high text-tertiary shadow-sm' : 'text-secondary hover:text-on-surface'"
          aria-label="Show personas tab"
          @click="tab = 'personas'"
        >
          <span>Personas</span>
          <span
            class="ml-1 rounded-full px-1.5 py-0.5 text-[11px]"
            :class="tab === 'personas' ? 'bg-surface-container text-secondary' : 'bg-surface-container-low text-secondary'"
          >
            {{ personaCount }}
          </span>
        </button>
      </div>
    </section>

    <section class="flex items-center justify-between px-6 py-2 text-[11px] font-medium text-secondary">
      <span class="flex items-center gap-1.5">
        <span class="text-primary">✦</span>
        <span>Dramatis Personae &amp; Archival Companions</span>
      </span>
      <button
        type="button"
        class="flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:text-primary"
        :class="selectionMode ? 'text-primary' : ''"
        :aria-pressed="selectionMode"
        aria-label="Toggle selection mode"
        @click="selectionMode ? exitSelection() : (selectionMode = true)"
      >
        <IconCheckSquare class="size-3.5" />
        <span>{{ selectionMode ? 'Selecting…' : 'Select' }}</span>
      </button>
    </section>

    <main class="flex flex-1 flex-col gap-3 px-5">
      <template v-if="tab === 'characters'">
        <div v-if="visibleCharacters.length > 0" class="grid grid-cols-2 gap-3.5 sm:gap-4">
          <CharacterCard
            v-for="character in visibleCharacters"
            :key="character.id"
            :character="character"
            :class="selectedIds.includes(character.id) ? 'ring-2 ring-primary' : ''"
            @open="openCharacter(character.id)"
            @edit="router.push(`/characters/${character.id}`)"
            @export-card="exportCard(character.id)"
            @delete="deleteCharacter(character.id)"
          />
        </div>
        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center gap-1 px-8 py-16 text-center"
        >
          <p class="font-serif text-lg italic text-on-surface-variant/85">No companions yet.</p>
          <p class="text-[13px] text-outline">Create a character or import a Tavern card.</p>
          <button
            type="button"
            class="mt-3 rounded-full bg-primary-container px-4 py-2 text-[13px] font-semibold text-on-primary-container transition active:scale-95"
            @click="newEntity"
          >
            Forge the first companion
          </button>
        </div>
        <div class="mt-2 flex items-start gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
          <span class="mt-0.5 text-primary">💡</span>
          <div class="flex-1">
            <h3 class="text-[13px] font-semibold text-on-surface">Chronicler's Quill</h3>
            <p class="mt-0.5 font-serif text-[12px] text-secondary">
              Press and hold any companion card to reveal archival bindings — edit, export as a
              SillyTavern card, or archive memories.
            </p>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="visiblePersonas.length > 0" class="flex flex-col gap-3">
          <PersonaCard
            v-for="persona in visiblePersonas"
            :key="persona.id"
            :persona="persona"
            @open="openPersona(persona.id)"
            @delete="deletePersona(persona.id)"
            @set-default="setDefaultPersona(persona.id)"
          />
        </div>
        <div v-else class="flex flex-1 flex-col items-center justify-center gap-1 px-8 py-16 text-center">
          <p class="font-serif text-lg italic text-on-surface-variant/85">No personas yet.</p>
          <p class="text-[13px] text-outline">Who are you in the story? Define your player persona.</p>
          <button
            type="button"
            class="mt-3 rounded-full bg-tertiary/25 px-4 py-2 text-[13px] font-semibold text-tertiary ring-1 ring-tertiary/40 transition active:scale-95"
            @click="newEntity"
          >
            Create your persona
          </button>
        </div>
      </template>
    </main>

    <!-- Batch selection action bar -->
    <div
      v-if="selectionMode && selectedIds.length > 0"
      class="fixed inset-x-0 bottom-16 z-40 mx-auto flex max-w-[520px] items-center justify-between gap-2 border-t border-outline-variant/30 bg-surface/95 px-5 py-3 backdrop-blur-md"
    >
      <span class="text-[13px] font-medium text-on-surface">{{ selectedIds.length }} selected</span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full border border-outline-variant/40 px-3 py-1.5 text-[12px] font-medium text-secondary transition-colors hover:text-primary"
          aria-label="Export selected cards"
          @click="exportSelected"
        >
          Export
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full bg-error-container px-3 py-1.5 text-[12px] font-semibold text-on-error transition active:scale-95"
          aria-label="Delete selected characters"
          @click="deleteSelected"
        >
          <IconTrash class="size-3.5" /> Delete
        </button>
        <button
          type="button"
          class="rounded-full px-2 py-1.5 text-[12px] text-secondary transition-colors hover:text-on-surface"
          aria-label="Exit selection mode"
          @click="exitSelection"
        >
          Cancel
        </button>
      </div>
    </div>

    <button
      type="button"
      aria-label="Forge new companion or persona"
      class="fixed right-5 bottom-24 z-40 flex size-14 items-center justify-center rounded-full bg-primary-container text-on-primary-container shadow-[0_8px_24px_-4px_rgba(217,119,6,0.35)] transition-all hover:opacity-95 active:scale-95"
      @click="newEntity"
    >
      <IconPlus class="size-6" />
    </button>

    <BottomNav />
    <ToastHost />
    <ConfirmDialog />
  </div>
</template>
