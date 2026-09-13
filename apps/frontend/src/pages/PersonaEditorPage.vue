<script setup lang="ts" vapor>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AvatarPicker from '@/components/characters/AvatarPicker.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import { useCharactersStore } from '@/stores/characters';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import IconChevronLeft from '~icons/lucide/chevron-left';
import IconPen from '~icons/lucide/pen-line';
import IconSave from '~icons/lucide/pen-line';
import IconTrash from '~icons/lucide/trash-2';

const route = useRoute();
const router = useRouter();
const store = useCharactersStore();
const ui = useUiStore();

const isNew = computed(() => route.params.id === undefined);
const personaId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null));
const loading = ref(!isNew.value);
const saving = ref(false);
const menuOpen = ref(false);

const draft = ref({
  name: '',
  description: '',
  avatarPath: null as string | null,
  isDefault: false,
});

onMounted(async () => {
  if (isNew.value || !personaId.value) return;
  const persona = await store.ensurePersona(personaId.value);
  if (!persona) {
    ui.notify('Persona not found', 'error');
    void router.replace('/characters');
    return;
  }
  draft.value = {
    name: persona.name,
    description: persona.description,
    avatarPath: persona.avatarPath,
    isDefault: persona.isDefault,
  };
  loading.value = false;
});

function setName(event: Event): void {
  draft.value.name = (event.target as HTMLInputElement).value;
}

function setDescription(event: Event): void {
  draft.value.description = (event.target as HTMLTextAreaElement).value;
}

function setAvatar(url: string | null): void {
  draft.value.avatarPath = url;
}

async function save(): Promise<void> {
  if (!draft.value.name.trim()) {
    ui.notify('Give your persona a name first', 'error');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: draft.value.name.trim(),
      description: draft.value.description,
      avatarPath: draft.value.avatarPath,
      isDefault: draft.value.isDefault,
    };
    if (isNew.value) {
      const persona = await store.createPersona(payload);
      ui.notify(`Persona “${persona.name}” created`, 'success');
      void router.replace(`/personas/${persona.id}`);
    } else if (personaId.value) {
      const persona = await store.updatePersona(personaId.value, payload);
      draft.value = {
        name: persona.name,
        description: persona.description,
        avatarPath: persona.avatarPath,
        isDefault: persona.isDefault,
      };
      ui.notify('Persona saved', 'success');
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

async function deletePersona(): Promise<void> {
  menuOpen.value = false;
  if (!personaId.value) return;
  const deleted = await store.removePersona(personaId.value);
  if (deleted) void router.replace('/characters');
}

const heading = computed(() => (isNew.value ? 'New Persona' : 'Edit Persona'));
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-105 flex-col border-x border-outline-variant/20 shadow-2xl">
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
        <span class="flex items-center gap-1 text-[11px] text-tertiary">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-tertiary" />
          Player Persona
        </span>
      </div>
      <div class="relative">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-full text-on-surface-variant transition-all hover:text-primary active:scale-95"
          aria-label="Persona options"
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
            aria-label="Delete persona"
            @click="deletePersona"
          >
            <IconTrash class="size-4 text-error" /> Delete Persona
          </button>
        </div>
      </div>
    </header>

    <main class="flex flex-1 flex-col gap-5 px-5 pb-36 pt-4">
      <section class="flex flex-col items-center pt-1">
        <AvatarPicker size="sm" :url="draft.avatarPath" :name="draft.name || 'You'" @update:url="setAvatar" />
      </section>

      <label class="flex flex-col gap-1.5">
        <span class="flex items-center gap-1.5 text-[12px] font-medium text-secondary">
          <IconPen class="size-3.5 text-tertiary" /> Name
        </span>
        <input
          type="text"
          :value="draft.name"
          placeholder="Who are you in the story?"
          aria-label="Persona name"
          class="rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2.5 text-[15px] font-semibold text-on-surface outline-none placeholder:text-outline focus:border-primary/60"
          @input="setName"
        />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-[12px] font-medium text-secondary">Description</span>
        <textarea
          rows="6"
          :value="draft.description"
          class="resize-none rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2.5 font-serif text-[15px] leading-relaxed text-on-surface outline-none placeholder:text-outline focus:border-primary/60"
          placeholder="Appearance, background, voice… how {{user}} should behave."
          aria-label="Persona description"
          @input="setDescription"
        />
      </label>

      <div class="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
        <div class="flex-1 pr-3">
          <div class="text-[13px] font-semibold text-on-surface">Set as default persona</div>
          <p class="mt-0.5 text-[11px] text-outline">
            Used when a new chat does not pick a persona. Only one persona can be default.
          </p>
        </div>
        <ToggleSwitch
          label="Set as default persona"
          :model-value="draft.isDefault"
          @update:model-value="draft.isDefault = $event"
        />
      </div>
    </main>

    <footer class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-105 border-t border-outline-variant/30 bg-surface/90 px-5 py-3 backdrop-blur-md">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-container py-3 text-[14px] font-semibold text-on-primary-container shadow-[0_4px_20px_-2px_rgba(192,132,252,0.35)] transition-all hover:shadow-[0_4px_24px_0px_rgba(192,132,252,0.5)] active:scale-95"
        :aria-label="isNew ? 'Create Persona' : 'Save Persona'"
        :disabled="saving || loading"
        @click="save"
      >
        <IconSave class="size-4" />
        <span>{{ saving ? 'Saving…' : isNew ? 'Create Persona' : 'Save Persona' }}</span>
      </button>
    </footer>

    <ToastHost />
    <ConfirmDialog />
  </div>
</template>
