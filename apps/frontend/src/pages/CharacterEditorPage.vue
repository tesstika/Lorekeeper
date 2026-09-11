<script setup lang="ts" vapor>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import AvatarPicker from '@/components/characters/AvatarPicker.vue';
import GreetingsManager from '@/components/characters/GreetingsManager.vue';
import SectionCard from '@/components/characters/SectionCard.vue';
import VoiceArchetypeChips from '@/components/characters/VoiceArchetypeChips.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import TagInput from '@/components/ui/TagInput.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import { useCharactersStore } from '@/stores/characters';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import IconBook from '~icons/lucide/book-open';
import IconPersonality from '~icons/lucide/brain';
import IconChevronLeft from '~icons/lucide/chevron-left';
import IconDownload from '~icons/lucide/download';
import IconEye from '~icons/lucide/eye';
import IconEyeOff from '~icons/lucide/eye-off';
import IconPen from '~icons/lucide/feather';
import IconDialogue from '~icons/lucide/messages-square';
import IconSave from '~icons/lucide/pen-line';
import IconAdvanced from '~icons/lucide/sliders-horizontal';
import IconTrash from '~icons/lucide/trash-2';

const route = useRoute();
const router = useRouter();
const store = useCharactersStore();
const ui = useUiStore();

const isNew = computed(() => route.params.id === undefined);
const characterId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null));
const loading = ref(!isNew.value);
const saving = ref(false);
const previewMode = ref(false);
const menuOpen = ref(false);

interface EditorDraft {
  name: string;
  tagline: string;
  tags: string[];
  avatarPath: string | null;
  description: string;
  personality: string;
  behavior: string;
  communicationStyle: string;
  likes: string;
  dislikes: string;
  backstory: string;
  scenario: string;
  creatorNotes: string;
  firstMessage: string;
  alternateGreetings: string[];
  exampleDialogue: string;
  systemExtras: string;
  jailbreak: string;
}

function emptyDraft(): EditorDraft {
  return {
    name: '',
    tagline: '',
    tags: [],
    avatarPath: null,
    description: '',
    personality: '',
    behavior: '',
    communicationStyle: '',
    likes: '',
    dislikes: '',
    backstory: '',
    scenario: '',
    creatorNotes: '',
    firstMessage: '',
    alternateGreetings: [],
    exampleDialogue: '',
    systemExtras: '',
    jailbreak: '',
  };
}

function draftFromCharacter(
  character: NonNullable<Awaited<ReturnType<typeof store.ensureCharacter>>>,
): EditorDraft {
  return {
    name: character.name,
    tagline: character.tagline ?? '',
    tags: [...character.tags],
    avatarPath: character.avatarPath,
    description: character.description,
    personality: character.personality,
    behavior: character.behavior,
    communicationStyle: character.communicationStyle,
    likes: character.likes,
    dislikes: character.dislikes,
    backstory: character.backstory,
    scenario: character.scenario,
    creatorNotes: character.creatorNotes,
    firstMessage: character.firstMessage,
    alternateGreetings: [...character.alternateGreetings],
    exampleDialogue: character.exampleDialogue,
    systemExtras: character.systemExtras,
    jailbreak: character.jailbreak,
  };
}

const draft = ref<EditorDraft>(emptyDraft());

onMounted(async () => {
  if (isNew.value || !characterId.value) return;
  const character = await store.ensureCharacter(characterId.value);
  if (!character) {
    ui.notify('Character not found', 'error');
    void router.replace('/characters');
    return;
  }
  draft.value = draftFromCharacter(character);
  loading.value = false;
});

// Vapor caution (M1 §4.3): every native input binds `:value` + explicit
// `@input` — never native v-model. Parents accept every emitted value, so the
// DOM cannot drift from the model.
function setText<K extends keyof EditorDraft>(key: K) {
  return (event: Event) => {
    draft.value[key] = (event.target as HTMLInputElement | HTMLTextAreaElement)
      .value as EditorDraft[K];
  };
}

function applyArchetype(archetype: { guideline: string }): void {
  const existing = draft.value.personality.trimEnd();
  draft.value.personality = existing
    ? `${existing}\n\n${archetype.guideline}`
    : archetype.guideline;
  ui.notify('Voice guideline appended to Personality', 'info');
}

function buildPayload() {
  return {
    name: draft.value.name.trim(),
    tagline: draft.value.tagline.trim() || null,
    tags: draft.value.tags,
    avatarPath: draft.value.avatarPath,
    description: draft.value.description,
    personality: draft.value.personality,
    behavior: draft.value.behavior,
    communicationStyle: draft.value.communicationStyle,
    likes: draft.value.likes,
    dislikes: draft.value.dislikes,
    backstory: draft.value.backstory,
    scenario: draft.value.scenario,
    creatorNotes: draft.value.creatorNotes,
    firstMessage: draft.value.firstMessage,
    alternateGreetings: [...draft.value.alternateGreetings],
    exampleDialogue: draft.value.exampleDialogue,
    systemExtras: draft.value.systemExtras,
    jailbreak: draft.value.jailbreak,
  };
}

async function save(): Promise<void> {
  if (!draft.value.name.trim()) {
    ui.notify('Give your character a name first', 'error');
    return;
  }
  saving.value = true;
  try {
    if (isNew.value) {
      const character = await store.createCharacter(buildPayload());
      ui.notify(`“${character.name}” forged`, 'success');
      void router.replace(`/characters/${character.id}`);
    } else if (characterId.value) {
      const character = await store.updateCharacter(characterId.value, buildPayload());
      draft.value = draftFromCharacter(character);
      ui.notify('Character saved', 'success');
    }
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  } finally {
    saving.value = false;
  }
}

function goBack(): void {
  void router.push('/characters');
}

function exportCard(): void {
  menuOpen.value = false;
  if (characterId.value) {
    api.exportCharacterCard(characterId.value, 'v2');
    ui.notify('Exporting card as SillyTavern V2 JSON', 'info');
  }
}

async function deleteCharacter(): Promise<void> {
  menuOpen.value = false;
  if (!characterId.value) return;
  const deleted = await store.removeCharacter(characterId.value);
  if (deleted) void router.replace('/characters');
}

const heading = computed(() =>
  isNew.value ? 'New Character' : draft.value.name.trim() || 'Edit Character',
);
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-105 flex-col border-x border-outline-variant/20 bg-surface shadow-2xl">
    <header class="sticky top-0 z-40 flex h-16 items-center justify-between bg-surface/90 px-5 backdrop-blur-md">
      <button
        type="button"
        class="flex items-center gap-1 py-2 text-[13px] font-medium text-on-surface-variant transition-colors hover:text-on-surface"
        aria-label="Back to characters"
        @click="goBack"
      >
        <IconChevronLeft class="size-4" /> Cancel
      </button>
      <div class="flex flex-col items-center">
        <h1 class="text-[15px] font-semibold tracking-tight text-on-surface">{{ heading }}</h1>
        <span class="flex items-center gap-1 text-[11px] text-primary">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          Manuscript Archive
        </span>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-full text-on-surface-variant transition-all hover:text-primary active:scale-95"
          :aria-label="previewMode ? 'Back to editing' : 'Preview card'"
          :aria-pressed="previewMode"
          @click="previewMode = !previewMode"
        >
          <IconEyeOff v-if="previewMode" class="size-5" />
          <IconEye v-else class="size-5" />
        </button>
        <div class="relative">
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-full text-on-surface-variant transition-all hover:text-primary active:scale-95"
            aria-label="Character options"
            @click="menuOpen = !menuOpen"
          >
            <span class="text-lg leading-none">⋯</span>
          </button>
          <div
            v-if="menuOpen"
            class="absolute right-0 top-11 z-50 w-44 rounded-xl border border-outline-variant/30 bg-surface-container p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container-high"
              :disabled="isNew"
              aria-label="Export card"
              @click="exportCard"
            >
              <IconDownload class="size-4 text-primary" /> Export Card
            </button>
            <div class="mx-1 my-1 h-px bg-outline-variant/20" />
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container-high"
              :disabled="isNew"
              aria-label="Delete character"
              @click="deleteCharacter"
            >
              <IconTrash class="size-4 text-error" /> Delete Character
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- PREVIEW MODE -->
    <main v-if="previewMode" class="flex flex-1 flex-col gap-4 px-5 pb-36 pt-4">
      <div class="flex flex-col items-center gap-2 text-center">
        <div class="size-24 overflow-hidden rounded-full p-1 ring-2 ring-primary/40">
          <div class="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-surface-container-high">
            <img v-if="draft.avatarPath" :src="draft.avatarPath" :alt="draft.name" class="h-full w-full object-cover" />
            <span v-else class="font-serif text-2xl text-primary/70">{{ draft.name.slice(0, 2) || '?' }}</span>
          </div>
        </div>
        <h2 class="text-[26px] font-semibold tracking-tight text-on-surface">{{ draft.name || 'Unnamed character' }}</h2>
        <p v-if="draft.tagline" class="font-serif text-[13px] italic text-primary">{{ draft.tagline }}</p>
        <div v-if="draft.tags.length > 0" class="flex flex-wrap justify-center gap-1.5">
          <span
            v-for="tag in draft.tags"
            :key="tag"
            class="rounded-md border border-outline-variant/20 bg-surface-container-lowest/80 px-2 py-0.5 text-[11px] text-primary"
          >
            {{ tag }}
          </span>
        </div>
      </div>
      <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
        <div class="flex items-center gap-2">
          <span class="rounded-md bg-secondary-container/50 px-1.5 py-0.5 text-[11px] text-on-surface">Character</span>
        </div>
        <div class="mt-2 border-l-2 border-primary/40 pl-3">
          <p class="whitespace-pre-wrap font-serif text-[16px] leading-relaxed text-on-surface">
            {{ draft.firstMessage || 'No greeting written yet — the tale has no opening line.' }}
          </p>
        </div>
      </div>
      <dl class="flex flex-col gap-3 rounded-xl bg-surface-container p-4">
        <div v-if="draft.description">
          <dt class="text-[11px] font-medium uppercase tracking-wide text-primary">Description</dt>
          <dd class="mt-1 whitespace-pre-wrap font-serif text-[14px] leading-relaxed text-on-surface-variant">{{ draft.description }}</dd>
        </div>
        <div v-if="draft.personality">
          <dt class="text-[11px] font-medium uppercase tracking-wide text-primary">Personality</dt>
          <dd class="mt-1 whitespace-pre-wrap font-serif text-[14px] leading-relaxed text-on-surface-variant">{{ draft.personality }}</dd>
        </div>
        <div v-if="draft.behavior">
          <dt class="text-[11px] font-medium uppercase tracking-wide text-primary">Behavior &amp; Mannerisms</dt>
          <dd class="mt-1 whitespace-pre-wrap font-serif text-[14px] leading-relaxed text-on-surface-variant">{{ draft.behavior }}</dd>
        </div>
        <div v-if="draft.scenario">
          <dt class="text-[11px] font-medium uppercase tracking-wide text-primary">Scenario</dt>
          <dd class="mt-1 whitespace-pre-wrap font-serif text-[14px] leading-relaxed text-on-surface-variant">{{ draft.scenario }}</dd>
        </div>
        <div v-if="draft.jailbreak">
          <dt class="text-[11px] font-medium uppercase tracking-wide text-error">Jailbreak (appended after history)</dt>
          <dd class="mt-1 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-on-surface-variant">{{ draft.jailbreak }}</dd>
        </div>
        <p v-if="!draft.description && !draft.personality && !draft.behavior && !draft.scenario" class="font-serif text-[14px] italic text-outline">
          Nothing to preview yet — fill in the sections below.
        </p>
      </dl>
    </main>

    <!-- EDIT MODE -->
    <main v-else class="flex flex-1 flex-col gap-3 px-5 pb-36 pt-4">
      <section class="flex flex-col items-center gap-1 pt-1">
        <AvatarPicker :url="draft.avatarPath" :name="draft.name || 'Unnamed'" @update:url="draft.avatarPath = $event" />
        <div class="mt-2 w-full">
          <input
            type="text"
            :value="draft.name"
            placeholder="Character Name"
            aria-label="Character name"
            class="w-full border-0 bg-transparent p-0 text-center text-[24px] font-semibold tracking-tight text-on-surface outline-none placeholder:text-outline-variant transition-colors hover:text-primary"
            @input="setText('name')($event)"
          />
          <div class="mt-1 flex items-center justify-center gap-1 text-on-surface-variant">
            <IconPen class="size-3 text-primary" />
            <input
              type="text"
              :value="draft.tagline"
              placeholder="Archetype or short subtitle tag"
              aria-label="Tagline"
              class="w-full max-w-70 border-0 bg-transparent p-0 text-center text-[13px] font-medium text-primary outline-none placeholder:text-outline-variant"
              @input="setText('tagline')($event)"
            />
          </div>
        </div>
        <div class="mt-2 w-full">
          <TagInput
            :model-value="draft.tags"
            label="genre tag"
            add-label="+ Tag"
            placeholder="Genre or mood tag…"
            @update:model-value="draft.tags = $event"
          />
        </div>
      </section>

      <SectionCard title="Personality & Essence" subtitle="Core demeanor, quirks & mannerisms" :default-open="true">
        <template #icon><IconPersonality class="size-4" /></template>
        <div class="flex flex-col gap-1.5">
          <label class="flex items-center justify-between text-[13px] text-on-surface-variant">
            <span>Description / Appearance</span>
            <span class="text-[11px] text-outline">Rich Prose</span>
          </label>
          <textarea
            rows="3"
            :value="draft.description"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-serif text-[15px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Who they are, how they look, how they carry themselves…"
            aria-label="Description"
            @input="setText('description')($event)"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="personality">Core Personality &amp; Traits</label>
          <textarea
            id="personality"
            rows="3"
            :value="draft.personality"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-serif text-[15px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Internal psychology, emotional walls, pride…"
            @input="setText('personality')($event)"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="behavior">Behavior &amp; Mannerisms</label>
          <textarea
            id="behavior"
            rows="2"
            :value="draft.behavior"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-serif text-[15px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Physical ticks, cadence, non-verbal habits…"
            @input="setText('behavior')($event)"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="communication">Communication Style</label>
          <input
            id="communication"
            type="text"
            :value="draft.communicationStyle"
            class="w-full rounded-lg border-0 bg-surface-container-lowest px-3 py-2.5 font-serif text-[15px] text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Formal prose, dry wit, understated metaphors…"
            @input="setText('communicationStyle')($event)"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <label class="flex items-center gap-1 text-[11px] text-primary">
              <span>▲</span> Affinities (Likes)
            </label>
            <input
              type="text"
              :value="draft.likes"
              class="w-full rounded-lg border-0 bg-surface-container-lowest px-2.5 py-2 text-[13px] text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
              placeholder="Aged leather folios…"
              aria-label="Likes"
              @input="setText('likes')($event)"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="flex items-center gap-1 text-[11px] text-tertiary">
              <span>▼</span> Aversions (Dislikes)
            </label>
            <input
              type="text"
              :value="draft.dislikes"
              class="w-full rounded-lg border-0 bg-surface-container-lowest px-2.5 py-2 text-[13px] text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
              placeholder="Damp matches, braggarts…"
              aria-label="Dislikes"
              @input="setText('dislikes')($event)"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Backstory & Scenario" subtitle="Origins, stakes & setting anchors">
        <template #icon><IconBook class="size-4" /></template>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="backstory">Character Backstory</label>
          <textarea
            id="backstory"
            rows="4"
            :value="draft.backstory"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-serif text-[15px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Chronicle lineage, trauma, motivation…"
            @input="setText('backstory')($event)"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="scenario">Current Scenario / Opening Setting</label>
          <textarea
            id="scenario"
            rows="2"
            :value="draft.scenario"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-serif text-[15px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Where the conversation begins…"
            @input="setText('scenario')($event)"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="creatorNotes">Creator Notes</label>
          <textarea
            id="creatorNotes"
            rows="2"
            :value="draft.creatorNotes"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-serif text-[14px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Notes for users of this card (exported as creator_notes)…"
            @input="setText('creatorNotes')($event)"
          />
        </div>
      </SectionCard>

      <SectionCard title="Dialogue & Greeting" subtitle="First impression passage & syntactic cadence">
        <template #icon><IconDialogue class="size-4" /></template>
        <div class="flex flex-col gap-1.5">
          <label class="flex items-center justify-between text-[13px] text-on-surface-variant" for="firstMessage">
            <span>Opening Greeting / First Message</span>
            <span class="text-[11px] text-primary">Kickoff Turn</span>
          </label>
          <div class="rounded-lg border-l-2 border-primary-container bg-surface-container-lowest p-3">
            <textarea
              id="firstMessage"
              rows="4"
              :value="draft.firstMessage"
              class="w-full resize-none border-0 bg-transparent p-0 font-serif text-[16px] leading-relaxed text-on-surface outline-none placeholder:text-outline-variant"
              placeholder="*Actions* in asterisks, spoken words in quotes…"
              @input="setText('firstMessage')($event)"
            />
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant">Alternate Greetings (chat openers)</label>
          <GreetingsManager
            :greetings="draft.alternateGreetings"
            @update:greetings="draft.alternateGreetings = $event"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="exampleDialogue">Example Dialogue Patterns (One-Shot)</label>
          <textarea
            id="exampleDialogue"
            rows="3"
            :value="draft.exampleDialogue"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-serif text-[15px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Exemplify voice patterns… {{user}} / {{char}} turns"
            @input="setText('exampleDialogue')($event)"
          />
        </div>
      </SectionCard>

      <SectionCard title="Advanced & System Directives" subtitle="LLM constraints & memory tuning">
        <template #icon><IconAdvanced class="size-4" /></template>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="systemExtras">System Extras (extra prompt directives)</label>
          <textarea
            id="systemExtras"
            rows="3"
            :value="draft.systemExtras"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-mono text-[12px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Model steering instructions… (card system_prompt)"
            @input="setText('systemExtras')($event)"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] text-on-surface-variant" for="jailbreak">Jailbreak (post-history directive)</label>
          <textarea
            id="jailbreak"
            rows="3"
            :value="draft.jailbreak"
            class="w-full resize-none rounded-lg border-0 bg-surface-container-lowest p-3 font-mono text-[12px] leading-relaxed text-on-surface outline-none ring-1 ring-transparent placeholder:text-outline-variant focus:ring-primary"
            placeholder="Anti-refusal preamble for combat / blood / weapons RP…"
            @input="setText('jailbreak')($event)"
          />
          <p class="text-[11px] leading-relaxed text-outline">
            Appended as the last system message after the chat history — merged after the global
            prompt-template directives, so the character-specific instruction sits closest to the
            generation point. Use it for mature-content allowances (combat, blood, weapons) that the
            base template does not cover.
          </p>
        </div>
      </SectionCard>

      <VoiceArchetypeChips @apply="applyArchetype" />
    </main>

    <footer class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-105 border-t border-outline-variant/30 bg-surface/90 px-5 py-3 backdrop-blur-md">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-container py-3 text-[14px] font-semibold text-on-primary-container shadow-[0_4px_20px_-2px_rgba(192,132,252,0.35)] transition-all hover:shadow-[0_4px_24px_0px_rgba(192,132,252,0.5)] active:scale-95"
        :aria-label="isNew ? 'Create Character' : 'Save Character'"
        :disabled="saving || loading"
        @click="save"
      >
        <IconSave class="size-4" />
        <span>{{ saving ? 'Saving…' : isNew ? 'Create Character' : 'Save Character' }}</span>
      </button>
    </footer>

    <ToastHost />
    <ConfirmDialog />
  </div>
</template>
