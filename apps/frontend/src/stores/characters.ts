import type {
  Character,
  CharacterCreateInput,
  CharacterPatch,
  ImportCardResponse,
  Persona,
  PersonaCreateInput,
  PersonaPatch,
} from '@lorekeeper/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ApiError, api } from '@/api';
import { describeApiError } from '@/utils/errors';
import { useUiStore } from './ui';

/**
 * Server state for characters & personas (plan §6.4): a pinia mirror with
 * load-once helpers, precise upserts and confirm-guarded deletions.
 */
export const useCharactersStore = defineStore('characters', () => {
  const ui = useUiStore();

  const characters = ref<Character[]>([]);
  const personas = ref<Persona[]>([]);
  const charactersLoaded = ref(false);
  const personasLoaded = ref(false);

  function upsertCharacter(character: Character): void {
    const index = characters.value.findIndex((c) => c.id === character.id);
    if (index >= 0) {
      characters.value.splice(index, 1, character);
    } else {
      characters.value.push(character);
    }
  }

  /** Mirrors the server's single-default invariant into the local list. */
  function upsertPersona(persona: Persona): void {
    const index = personas.value.findIndex((p) => p.id === persona.id);
    if (index >= 0) {
      personas.value.splice(index, 1, persona);
    } else {
      personas.value.push(persona);
    }
    if (persona.isDefault) {
      personas.value = personas.value.map((p) =>
        p.id === persona.id ? p : { ...p, isDefault: false },
      );
    }
  }

  function removeLocalCharacter(id: string): void {
    characters.value = characters.value.filter((c) => c.id !== id);
  }

  function removeLocalPersona(id: string): void {
    personas.value = personas.value.filter((p) => p.id !== id);
  }

  async function loadCharacters(force = false): Promise<void> {
    if (charactersLoaded.value && !force) return;
    try {
      characters.value = await api.getCharacters();
      charactersLoaded.value = true;
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
    }
  }

  async function loadPersonas(force = false): Promise<void> {
    if (personasLoaded.value && !force) return;
    try {
      personas.value = await api.getPersonas();
      personasLoaded.value = true;
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
    }
  }

  /** Finds a character in the cache or fetches it directly (editor deep-links). */
  async function ensureCharacter(id: string): Promise<Character | null> {
    const cached = characters.value.find((c) => c.id === id);
    if (cached) return cached;
    try {
      const character = await api.getCharacter(id);
      upsertCharacter(character);
      return character;
    } catch {
      return null;
    }
  }

  async function ensurePersona(id: string): Promise<Persona | null> {
    const cached = personas.value.find((p) => p.id === id);
    if (cached) return cached;
    try {
      const persona = await api.getPersona(id);
      upsertPersona(persona);
      return persona;
    } catch {
      return null;
    }
  }

  async function createCharacter(input: CharacterCreateInput): Promise<Character> {
    const character = await api.createCharacter(input);
    upsertCharacter(character);
    return character;
  }

  async function updateCharacter(id: string, patch: CharacterPatch): Promise<Character> {
    const character = await api.updateCharacter(id, patch);
    upsertCharacter(character);
    return character;
  }

  async function importCard(payload: unknown): Promise<ImportCardResponse> {
    const result = await api.importCard(payload);
    upsertCharacter(result.character);
    ui.notify(
      `Imported “${result.character.name}” (${result.detectedFormat.toUpperCase()} card)`,
      'success',
    );
    return result;
  }

  async function removeCharacter(id: string): Promise<boolean> {
    const character = characters.value.find((c) => c.id === id);
    const name = character?.name ?? 'This character';
    // D7: every destructive action confirms — the grid delete always asks first.
    const accepted = await ui.confirm({
      title: `Delete “${name}”?`,
      message: 'The character and its card data are removed. This cannot be undone.',
      confirmLabel: 'Delete character',
      danger: true,
    });
    if (!accepted) return false;
    try {
      await api.deleteCharacter(id);
      removeLocalCharacter(id);
      ui.notify(`Deleted “${name}”`, 'info');
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.statusCode === 409 &&
        error.code === 'character_in_use'
      ) {
        const accepted2 = await ui.confirm({
          title: `Delete “${name}” and its chats?`,
          message: error.message,
          confirmLabel: 'Delete character & chats',
          danger: true,
        });
        if (!accepted2) return false;
        try {
          await api.deleteCharacter(id, true);
          removeLocalCharacter(id);
          ui.notify(`Deleted “${name}” and its chats`, 'info');
          return true;
        } catch (forceError) {
          ui.notify(describeApiError(forceError), 'error');
          return false;
        }
      }
      ui.notify(describeApiError(error), 'error');
      return false;
    }
  }

  async function createPersona(input: PersonaCreateInput): Promise<Persona> {
    const persona = await api.createPersona(input);
    upsertPersona(persona);
    return persona;
  }

  async function updatePersona(id: string, patch: PersonaPatch): Promise<Persona> {
    const persona = await api.updatePersona(id, patch);
    upsertPersona(persona);
    return persona;
  }

  async function removePersona(id: string): Promise<boolean> {
    const persona = personas.value.find((p) => p.id === id);
    const name = persona?.name ?? 'This persona';
    const accepted = await ui.confirm({
      title: `Delete “${name}”?`,
      message: 'The persona will be removed. Existing chats keep running without one.',
      confirmLabel: 'Delete persona',
      danger: true,
    });
    if (!accepted) return false;
    try {
      await api.deletePersona(id);
      removeLocalPersona(id);
      ui.notify(`Deleted “${name}”`, 'info');
      return true;
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
      return false;
    }
  }

  async function setDefaultPersona(id: string): Promise<void> {
    const { persona } = await api.setDefaultPersona(id);
    upsertPersona(persona);
    ui.notify(`“${persona.name}” is now the default persona`, 'success');
  }

  return {
    characters,
    personas,
    charactersLoaded,
    personasLoaded,
    loadCharacters,
    loadPersonas,
    ensureCharacter,
    ensurePersona,
    createCharacter,
    updateCharacter,
    importCard,
    removeCharacter,
    createPersona,
    updatePersona,
    removePersona,
    setDefaultPersona,
  };
});
