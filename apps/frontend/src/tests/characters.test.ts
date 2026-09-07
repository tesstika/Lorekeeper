import type { Character, Persona } from '@lorekeeper/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, vaporInteropPlugin } from 'vue';
import CharacterCard from '../components/characters/CharacterCard.vue';
import GreetingsManager from '../components/characters/GreetingsManager.vue';
import PersonaCard from '../components/characters/PersonaCard.vue';
import SectionCard from '../components/characters/SectionCard.vue';
import CharacterEditorPage from '../pages/CharacterEditorPage.vue';
import CharactersPage from '../pages/CharactersPage.vue';
import PersonaEditorPage from '../pages/PersonaEditorPage.vue';
import { router } from '../router';

const NOW = '2026-09-07T00:00:00.000Z';

const characterFixture: Character = {
  id: 'c1',
  name: 'Lady Vivienne de Valois',
  tagline: 'Victorian Occultist & Archival Heiress',
  tags: ['Noir', 'Victorian'],
  avatarPath: null,
  description: 'A moody Victorian occultist.',
  creatorNotes: '',
  extensions: {},
  personality: 'Sharp-witted.',
  behavior: '',
  communicationStyle: '',
  likes: '',
  dislikes: '',
  backstory: '',
  scenario: '',
  exampleDialogue: '',
  firstMessage: '*The clock strikes three.* "Tell me—did the rain follow you down?"',
  alternateGreetings: ['*She looks up.*'],
  systemExtras: '',
  jailbreak: 'Combat and blood are allowed in this tale.',
  createdAt: NOW,
  updatedAt: NOW,
};

const personaFixture: Persona = {
  id: 'p1',
  name: 'The Chronicler',
  description: 'A wandering archivist.',
  avatarPath: null,
  isDefault: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const apiState = vi.hoisted(() => ({
  characters: [] as Character[],
  personas: [] as Persona[],
  calls: {
    createCharacter: [] as unknown[],
    updateCharacter: [] as unknown[],
    deleteCharacter: [] as string[],
    createPersona: [] as unknown[],
    updatePersona: [] as unknown[],
    deletePersona: [] as string[],
    setDefaultPersona: [] as string[],
    exportCard: [] as string[],
  },
  reset(): void {
    this.characters = [];
    this.personas = [];
    this.calls.createCharacter = [];
    this.calls.updateCharacter = [];
    this.calls.deleteCharacter = [];
    this.calls.createPersona = [];
    this.calls.updatePersona = [];
    this.calls.deletePersona = [];
    this.calls.setDefaultPersona = [];
    this.calls.exportCard = [];
  },
}));

vi.mock('@/api', () => ({
  ApiError: class ApiError extends Error {
    code = 'http_error';
    statusCode = 400;
  },
  api: {
    getCharacters: async () => JSON.parse(JSON.stringify(apiState.characters)),
    getCharacter: async (id: string) =>
      JSON.parse(JSON.stringify(apiState.characters.find((c) => c.id === id))),
    createCharacter: async (input: Record<string, unknown>) => {
      apiState.calls.createCharacter.push(input);
      const character = {
        ...input,
        id: `c${apiState.characters.length + 1}`,
        createdAt: NOW,
        updatedAt: NOW,
      } as Character;
      apiState.characters.push(character);
      return JSON.parse(JSON.stringify(character));
    },
    updateCharacter: async (id: string, patch: Record<string, unknown>) => {
      apiState.calls.updateCharacter.push({ id, patch });
      const index = apiState.characters.findIndex((c) => c.id === id);
      apiState.characters[index] = {
        ...apiState.characters[index],
        ...patch,
        updatedAt: NOW,
      } as Character;
      return JSON.parse(JSON.stringify(apiState.characters[index]));
    },
    deleteCharacter: async (id: string) => {
      apiState.calls.deleteCharacter.push(id);
      apiState.characters = apiState.characters.filter((c) => c.id !== id);
      return { ok: true as const };
    },
    importCard: async () => {
      throw new Error('not used in this suite');
    },
    getPersonas: async () => JSON.parse(JSON.stringify(apiState.personas)),
    getPersona: async (id: string) =>
      JSON.parse(JSON.stringify(apiState.personas.find((p) => p.id === id))),
    createPersona: async (input: Record<string, unknown>) => {
      apiState.calls.createPersona.push(input);
      const persona = {
        ...input,
        id: `p${apiState.personas.length + 1}`,
        createdAt: NOW,
        updatedAt: NOW,
      } as Persona;
      apiState.personas.push(persona);
      return JSON.parse(JSON.stringify(persona));
    },
    updatePersona: async (id: string, patch: Record<string, unknown>) => {
      apiState.calls.updatePersona.push({ id, patch });
      const index = apiState.personas.findIndex((p) => p.id === id);
      apiState.personas[index] = { ...apiState.personas[index], ...patch } as Persona;
      return JSON.parse(JSON.stringify(apiState.personas[index]));
    },
    deletePersona: async (id: string) => {
      apiState.calls.deletePersona.push(id);
      apiState.personas = apiState.personas.filter((p) => p.id !== id);
      return { ok: true as const };
    },
    setDefaultPersona: async (id: string) => {
      apiState.calls.setDefaultPersona.push(id);
      apiState.personas = apiState.personas.map((p) => ({ ...p, isDefault: p.id === id }));
      return { persona: JSON.parse(JSON.stringify(apiState.personas.find((p) => p.id === id))) };
    },
    exportCharacterCard: (id: string) => {
      apiState.calls.exportCard.push(id);
    },
    uploadAttachment: async () => ({
      id: 'a1',
      url: '/media/x.png',
      width: 1,
      height: 1,
      mimeType: 'image/png',
      sizeBytes: 1,
      originalName: 'x.png',
    }),
  },
}));

function host(
  template: string,
  components: Record<string, object>,
): ReturnType<typeof defineComponent> {
  return defineComponent({ components, template });
}

/** Expands every collapsed accordion section in an editor page. */
async function expandSections(wrapper: ReturnType<typeof mount>): Promise<void> {
  for (const toggle of wrapper.findAll('button[aria-expanded="false"]')) {
    await toggle.trigger('click');
  }
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiState.reset();
  apiState.characters = [JSON.parse(JSON.stringify(characterFixture))];
  apiState.personas = [JSON.parse(JSON.stringify(personaFixture))];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('editor building blocks', () => {
  it('SectionCard toggles its collapsible content', async () => {
    const Host = host(
      `<div>
        <SectionCard title="Personality & Essence" subtitle="Core demeanor">
          <template #icon><span>icon</span></template>
          <p data-testid="body">Body content</p>
        </SectionCard>
      </div>`,
      { SectionCard },
    );
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });
    expect(wrapper.text()).toContain('Personality & Essence');
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(false);
    await wrapper.find('button[aria-expanded]').trigger('click');
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-expanded]').attributes('aria-expanded')).toBe('true');
    await wrapper.find('button[aria-expanded]').trigger('click');
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(false);
  });

  it('GreetingsManager adds, edits and removes alternate greetings', async () => {
    const Host = host(
      '<div><GreetingsManager :greetings="greetings" @update:greetings="greetings = $event" /></div>',
      {
        GreetingsManager,
      },
    );
    const wrapper = mount(Host, {
      data: () => ({ greetings: ['First.'] }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await wrapper.find('button[aria-label="Add alternate greeting"]').trigger('click');
    expect((wrapper.vm as unknown as { greetings: string[] }).greetings).toEqual(['First.', '']);

    await wrapper.find('textarea[aria-label="Alternate greeting 2"]').setValue('Second opening.');
    expect((wrapper.vm as unknown as { greetings: string[] }).greetings).toEqual([
      'First.',
      'Second opening.',
    ]);

    await wrapper.find('button[aria-label="Remove greeting 1"]').trigger('click');
    expect((wrapper.vm as unknown as { greetings: string[] }).greetings).toEqual([
      'Second opening.',
    ]);
  });
});

describe('cards', () => {
  it('CharacterCard renders identity and exposes quick actions', async () => {
    const Host = host('<div><CharacterCard :character="character" @edit="edited = true" /></div>', {
      CharacterCard,
    });
    const wrapper = mount(Host, {
      data: () => ({ character: characterFixture, edited: false }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('Lady Vivienne de Valois');
    expect(wrapper.text()).toContain('Victorian Occultist & Archival Heiress');
    expect(wrapper.text()).toContain('Noir');
    // Initials fallback (no avatarPath).
    expect(wrapper.text()).toContain('LV');

    await wrapper.find('button[aria-label="Actions for Lady Vivienne de Valois"]').trigger('click');
    await wrapper.find('button[aria-label="Edit Lady Vivienne de Valois"]').trigger('click');
    expect((wrapper.vm as unknown as { edited: boolean }).edited).toBe(true);
    expect(wrapper.find('button[aria-label="Delete Lady Vivienne de Valois"]').exists()).toBe(true);
  });

  it('PersonaCard shows the Default chip and emits setDefault/delete', async () => {
    const Host = host(
      '<div><PersonaCard :persona="persona" @set-default="def = true" @delete="deleted = true" /></div>',
      { PersonaCard },
    );
    const wrapper = mount(Host, {
      data: () => ({ persona: personaFixture, def: false, deleted: false }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('The Chronicler');
    expect(wrapper.text()).toContain('Default');
    expect(
      wrapper.find('button[aria-label="Set The Chronicler as default persona"]').exists(),
    ).toBe(false);

    const plain = { ...personaFixture, isDefault: false };
    await wrapper.setData({ persona: plain });
    await wrapper
      .find('button[aria-label="Set The Chronicler as default persona"]')
      .trigger('click');
    expect((wrapper.vm as unknown as { def: boolean }).def).toBe(true);
    await wrapper.find('button[aria-label="Delete persona The Chronicler"]').trigger('click');
    expect((wrapper.vm as unknown as { deleted: boolean }).deleted).toBe(true);
  });
});

describe('CharactersPage', () => {
  async function mountPage() {
    const Host = host('<div><CharactersPage /></div>', { CharactersPage });
    const wrapper = mount(Host, {
      global: { plugins: [vaporInteropPlugin, router] },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  }

  it('renders the character grid with tabs and counts', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Characters');
    expect(wrapper.text()).toContain('Lady Vivienne de Valois');
    expect(wrapper.text()).toContain('Import Card');
  });

  it('switches to the personas tab and back', async () => {
    const wrapper = await mountPage();
    await wrapper.find('button[aria-label="Show personas tab"]').trigger('click');
    expect(wrapper.text()).toContain('The Chronicler');
    expect(wrapper.text()).not.toContain('Lady Vivienne de Valois');
    await wrapper.find('button[aria-label="Show characters tab"]').trigger('click');
    expect(wrapper.text()).toContain('Lady Vivienne de Valois');
  });

  it('selection mode selects cards and batch-deletes with a confirm dialog', async () => {
    const wrapper = await mountPage();
    await wrapper.find('button[aria-label="Toggle selection mode"]').trigger('click');
    await wrapper.find('button[aria-label="Open Lady Vivienne de Valois"]').trigger('click');
    expect(wrapper.text()).toContain('1 selected');
    await wrapper.find('button[aria-label="Delete selected characters"]').trigger('click');
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    const confirmButton = dialog.findAll('button').find((b) => b.text() === 'Delete');
    await confirmButton?.trigger('click');
    await flushPromises();
    expect(apiState.calls.deleteCharacter).toContain('c1');
    expect(apiState.characters).toHaveLength(0);
  });

  it('per-card delete opens the confirm dialog and removes the character', async () => {
    const wrapper = await mountPage();
    await wrapper.find('button[aria-label="Actions for Lady Vivienne de Valois"]').trigger('click');
    await wrapper.find('button[aria-label="Delete Lady Vivienne de Valois"]').trigger('click');
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    const confirmButton = dialog.findAll('button').find((b) => b.text() === 'Delete character');
    await confirmButton?.trigger('click');
    await flushPromises();
    expect(apiState.calls.deleteCharacter).toContain('c1');
  });
});

describe('CharacterEditorPage (new)', () => {
  it('creates a character with greeting and jailbreak fields', async () => {
    await router.push('/characters/new');
    await router.isReady();
    const Host = host('<div><CharacterEditorPage /></div>', { CharacterEditorPage });
    const wrapper = mount(Host, {
      global: { plugins: [vaporInteropPlugin, router] },
      attachTo: document.body,
    });
    await flushPromises();

    await wrapper.find('input[aria-label="Character name"]').setValue('Captain Vance');
    await wrapper.find('textarea[aria-label="Description"]').setValue('An aether-naut.');
    await expandSections(wrapper);
    await wrapper.find('#jailbreak').setValue('Combat and blood are allowed.');
    await wrapper.find('button[aria-label="Add alternate greeting"]').trigger('click');
    await wrapper.find('textarea[aria-label="Alternate greeting 1"]').setValue('*Nods.*');
    await wrapper.find('button[aria-label="Add alternate greeting"]').trigger('click');
    await wrapper.find('textarea[aria-label="Alternate greeting 2"]').setValue('*Smirks.*');

    await wrapper.find('button[aria-label="Create Character"]').trigger('click');
    await flushPromises();

    expect(apiState.calls.createCharacter).toHaveLength(1);
    const payload = apiState.calls.createCharacter[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: 'Captain Vance',
      description: 'An aether-naut.',
      jailbreak: 'Combat and blood are allowed.',
    });
    expect(payload.alternateGreetings).toEqual(['*Nods.*', '*Smirks.*']);
  });

  it('applies a voice archetype into the personality field', async () => {
    await router.push('/characters/new');
    await router.isReady();
    const Host = host('<div><CharacterEditorPage /></div>', { CharacterEditorPage });
    const wrapper = mount(Host, {
      global: { plugins: [vaporInteropPlugin, router] },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.find('button[aria-label="Apply Archaic Scholar voice"]').trigger('click');
    await wrapper.find('input[aria-label="Character name"]').setValue('Scholar');
    await wrapper.find('button[aria-label="Create Character"]').trigger('click');
    await flushPromises();
    const payload = apiState.calls.createCharacter[0] as Record<string, unknown>;
    expect(String(payload.personality)).toContain('measured archaic prose');
  });

  it('loads an existing character and saves a full PATCH without clobbering', async () => {
    await router.push('/characters/c1');
    await router.isReady();
    const Host = host('<div><CharacterEditorPage /></div>', { CharacterEditorPage });
    const wrapper = mount(Host, {
      global: { plugins: [vaporInteropPlugin, router] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(
      (wrapper.find('input[aria-label="Character name"]').element as HTMLInputElement).value,
    ).toBe('Lady Vivienne de Valois');
    await expandSections(wrapper);
    expect((wrapper.find('#jailbreak').element as HTMLTextAreaElement).value).toContain(
      'Combat and blood',
    );

    await wrapper.find('input[aria-label="Tagline"]').setValue('New tagline');
    await wrapper.find('button[aria-label="Save Character"]').trigger('click');
    await flushPromises();
    expect(apiState.calls.updateCharacter).toHaveLength(1);
    const { patch } = apiState.calls.updateCharacter[0] as { patch: Record<string, unknown> };
    expect(patch).toMatchObject({
      name: 'Lady Vivienne de Valois',
      tagline: 'New tagline',
      jailbreak: 'Combat and blood are allowed in this tale.',
    });
    // Untouched keys ride along with their loaded values (no default injection).
    expect(patch.personality).toBe('Sharp-witted.');
    expect(patch.firstMessage).toContain('clock strikes three');
  });
});

describe('PersonaEditorPage', () => {
  it('creates a persona with the default flag', async () => {
    await router.push('/personas/new');
    await router.isReady();
    const Host = host('<div><PersonaEditorPage /></div>', { PersonaEditorPage });
    const wrapper = mount(Host, {
      global: { plugins: [vaporInteropPlugin, router] },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.find('input[aria-label="Persona name"]').setValue('The Chronicler');
    await wrapper
      .find('textarea[aria-label="Persona description"]')
      .setValue('A wandering archivist.');
    await wrapper.find('button[role="switch"]').trigger('click');
    await wrapper.find('button[aria-label="Create Persona"]').trigger('click');
    await flushPromises();
    expect(apiState.calls.createPersona).toHaveLength(1);
    expect(apiState.calls.createPersona[0]).toMatchObject({
      name: 'The Chronicler',
      description: 'A wandering archivist.',
      isDefault: true,
    });
  });
});
