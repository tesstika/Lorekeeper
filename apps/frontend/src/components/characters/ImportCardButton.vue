<script setup lang="ts" vapor>
import { ref } from 'vue';
import { useCharactersStore } from '@/stores/characters';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import IconUpload from '~icons/lucide/file-up';

// Header action per the mockup: Import Lore Codex → opens the OS file dialog
// for a JSON character card (V1 / V2 / V3), parses it and POSTs it to the
// import endpoint. Emits `imported` with the new character id for navigation.
const emit = defineEmits<{ imported: [characterId: string] }>();

const store = useCharactersStore();
const ui = useUiStore();
const inputEl = ref<HTMLInputElement | null>(null);
const importing = ref(false);

function openDialog(): void {
  inputEl.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importing.value = true;
  try {
    const text = await file.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      ui.notify('That file is not valid JSON — pick an exported character card (.json).', 'error');
      return;
    }
    const result = await store.importCard(payload);
    emit('imported', result.character.id);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="flex items-center gap-1.5 rounded-full border border-outline-variant/40 px-3 py-1.5 text-[12px] font-medium text-secondary transition-colors hover:border-primary/50 hover:text-primary"
    :disabled="importing"
    aria-label="Import character card"
    @click="openDialog"
  >
    <IconUpload class="size-4" />
    <span class="hidden sm:inline">{{ importing ? 'Importing…' : 'Import Card' }}</span>
  </button>
  <input ref="inputEl" type="file" accept="application/json,.json" class="hidden" @change="onFileChange" />
</template>
