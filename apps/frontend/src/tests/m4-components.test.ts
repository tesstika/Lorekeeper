import type { AttachmentInfo, ChatMessage } from '@lorekeeper/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, vaporInteropPlugin } from 'vue';
import ImageGrid from '../components/chat/ImageGrid.vue';
import ImageLightbox from '../components/chat/ImageLightbox.vue';
import MessageItem from '../components/chat/MessageItem.vue';
import BottomSheet from '../components/ui/BottomSheet.vue';
import ConfirmDialog from '../components/ui/ConfirmDialog.vue';
import { useChatsStore } from '../stores/chats';
import { useUiStore } from '../stores/ui';

function host(
  template: string,
  components: Record<string, object>,
): ReturnType<typeof defineComponent> {
  return defineComponent({ components, template });
}

const NOW = '2026-09-08T12:00:00.000Z';

function attachment(overrides: Partial<AttachmentInfo> = {}): AttachmentInfo {
  return {
    id: 'att1',
    url: '/media/att1.png',
    width: 800,
    height: 600,
    mimeType: 'image/png',
    originalName: 'wax-seal.png',
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}): ChatMessage {
  return {
    id: 'm1',
    seq: 1,
    role: 'assistant',
    groupId: 'g1',
    isGreeting: false,
    isError: false,
    error: null,
    variants: [
      {
        id: 'v1',
        variantIndex: 0,
        isActive: true,
        text: 'A reply.',
        finishReason: 'stop',
        isError: false,
        error: null,
        usage: null,
        createdAt: NOW,
      },
    ],
    activeVariantId: 'v1',
    attachments: [],
    usage: null,
    finishReason: 'stop',
    ...overrides,
  } as ChatMessage;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ImageGrid lightbox (D-T7)
// ---------------------------------------------------------------------------

describe('ImageLightbox (D-T7)', () => {
  it('renders the high-res image and closes on the × button', async () => {
    const Host = host('<div><ImageLightbox :attachment="att" @close="closed += 1" /></div>', {
      ImageLightbox,
    });
    const wrapper = mount(Host, {
      data: () => ({ att: attachment(), closed: 0 }),
      global: { plugins: [vaporInteropPlugin] },
      attachTo: document.body,
    });
    expect(wrapper.find('img').attributes('src')).toBe('/media/att1.png');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await wrapper.find('button[aria-label="Close image viewer"]').trigger('click');
    expect((wrapper.vm as unknown as { closed: number }).closed).toBe(1);
    wrapper.unmount();
  });

  it('closes on Escape and on backdrop click', async () => {
    const Host = host('<div><ImageLightbox :attachment="att" @close="closed += 1" /></div>', {
      ImageLightbox,
    });
    const wrapper = mount(Host, {
      data: () => ({ att: attachment(), closed: 0 }),
      global: { plugins: [vaporInteropPlugin] },
      attachTo: document.body,
    });
    const dialog = wrapper.find('[role="dialog"]');
    await dialog.trigger('keydown', { key: 'Escape' });
    expect((wrapper.vm as unknown as { closed: number }).closed).toBe(1);

    // Backdrop click: the dialog itself is the .self target.
    await dialog.trigger('click');
    expect((wrapper.vm as unknown as { closed: number }).closed).toBe(2);
    wrapper.unmount();
  });

  it('moves focus into the dialog on open and restores it on unmount', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const Host = host('<div><ImageLightbox :attachment="att" @close="closed += 1" /></div>', {
      ImageLightbox,
    });
    const wrapper = mount(Host, {
      data: () => ({ att: attachment(), closed: 0 }),
      global: { plugins: [vaporInteropPlugin] },
      attachTo: document.body,
    });
    await flushPromises();
    // First focusable = the close button.
    expect(document.activeElement).toBe(
      wrapper.find('button[aria-label="Close image viewer"]').element,
    );

    wrapper.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('ImageGrid', () => {
  it('opens the lightbox from a thumbnail click and closes it again', async () => {
    const Host = host('<div><ImageGrid :attachments="items" /></div>', { ImageGrid });
    const wrapper = mount(Host, {
      data: () => ({ items: [attachment()] }),
      global: { plugins: [vaporInteropPlugin] },
      attachTo: document.body,
    });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await wrapper.find('button[aria-label="View image wax-seal.png"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await wrapper.find('button[aria-label="Close image viewer"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

// ---------------------------------------------------------------------------
// Touch tap-reveal (M3 Deviation 3 rider)
// ---------------------------------------------------------------------------

describe('MessageItem tap-reveal actions', () => {
  function stubViewport(matches: boolean): void {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches }));
  }

  it('toggles the action bar on tap for narrow viewports', async () => {
    stubViewport(true); // mobile
    const wrapper = mount(
      host(
        '<div><MessageItem :message="m" display-name="Vivienne" :avatar-path="null" tone="character" /></div>',
        { MessageItem },
      ),
      {
        data: () => ({ m: message() }),
        global: { plugins: [vaporInteropPlugin] },
      },
    );
    const actions = wrapper.find('[aria-label="Copy message"]').element
      .parentElement as HTMLElement;
    expect(actions.classList.contains('opacity-100')).toBe(false);

    await wrapper.find('article').trigger('click');
    expect(actions.classList.contains('opacity-100')).toBe(true);

    await wrapper.find('article').trigger('click');
    expect(actions.classList.contains('opacity-100')).toBe(false);
  });

  it('does not toggle on desktop viewports and ignores taps on buttons', async () => {
    stubViewport(false); // desktop
    const wrapper = mount(
      host(
        '<div><MessageItem :message="m" display-name="Vivienne" :avatar-path="null" tone="character" /></div>',
        { MessageItem },
      ),
      {
        data: () => ({ m: message() }),
        global: { plugins: [vaporInteropPlugin] },
      },
    );
    const actions = wrapper.find('[aria-label="Copy message"]').element
      .parentElement as HTMLElement;
    await wrapper.find('article').trigger('click');
    expect(actions.classList.contains('opacity-100')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Overlay a11y: BottomSheet + ConfirmDialog
// ---------------------------------------------------------------------------

describe('BottomSheet focus management (M4 a11y)', () => {
  it('traps Escape and restores focus to the trigger on unmount', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const Host = host(
      '<div><BottomSheet :open="open" title="Sheet" @close="open = false"><p>content</p></BottomSheet></div>',
      { BottomSheet },
    );
    const wrapper = mount(Host, {
      data: () => ({ open: true }),
      global: { plugins: [vaporInteropPlugin] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    // Focus moved to the first focusable element (the close button).
    expect(document.activeElement).toBe(wrapper.find('button[aria-label="Close sheet"]').element);

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect((wrapper.vm as unknown as { open: boolean }).open).toBe(false);

    wrapper.unmount();
    // Focus restored to the trigger element.
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('ConfirmDialog focus management (M4 a11y)', () => {
  it('cancels the pending confirm on Escape and returns focus', async () => {
    const ui = useUiStore();
    const wrapper = mount(host('<div><ConfirmDialog /></div>', { ConfirmDialog }), {
      global: { plugins: [vaporInteropPlugin] },
      attachTo: document.body,
    });

    const confirmPromise = ui.confirm({ title: 'Delete?', message: 'Sure?' });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await expect(confirmPromise).resolves.toBe(false);
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

// ---------------------------------------------------------------------------
// ChatSettingsSheet — per-chat override pickers (M4)
// ---------------------------------------------------------------------------

const apiState = vi.hoisted(() => {
  return {
    updateChatCalls: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    reset(): void {
      this.updateChatCalls = [];
    },
  };
});

vi.mock('@/api', async (importOriginal) => {
  const original = (await importOriginal()) as { api: Record<string, unknown> };
  return {
    ...original,
    api: {
      ...original.api,
      getSettings: async () => ({
        globalDefaults: {
          providerId: 'openrouter',
          modelId: 'default/model',
          presetId: null,
          personaId: null,
          contextBudgetTokens: 8192,
          keepLastNVariants: 20,
        },
        promptTemplate: { systemTemplate: 'T', postHistoryInstructions: '' },
        composer: {
          enterToSend: true,
          autoScroll: true,
          imageMaxBytes: 8388608,
          editDefaultRegenerate: false,
          caretBlinkMs: 500,
          deliveredBlinkMs: 250,
          deliveredBlinks: 6,
        },
      }),
      getProviders: async () => [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          baseUrl: '',
          hasKey: true,
          keyHint: null,
          status: 'connected',
          latencyMs: 1,
          modelsFetchedAt: null,
        },
      ],
      getPresets: async () => [
        {
          id: 'preset-1',
          name: 'Epic Saga',
          description: '',
          temperature: 0.9,
          topP: 0.95,
          topK: null,
          maxTokens: 2048,
          frequencyPenalty: 0,
          presencePenalty: 0,
          repetitionPenalty: null,
          stopSequences: [],
          isDefault: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      getProviderModels: async () => ({
        models: [
          { id: 'test/model', name: 'Test Model', contextLength: 32000, inputModalities: ['text'] },
          {
            id: 'vision/model',
            name: 'Vision Model',
            contextLength: 64000,
            inputModalities: ['text', 'image'],
          },
        ],
        fetchedAt: NOW,
        cached: false,
      }),
      getPersonas: async () => [
        {
          id: 'persona-1',
          name: 'Rowan the Scribe',
          description: '',
          avatarPath: null,
          isDefault: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      updateChat: async (id: string, patch: Record<string, unknown>) => {
        apiState.updateChatCalls.push({ id, patch });
        return { id: 'chat-1' };
      },
    },
  };
});

async function mountSettingsSheet() {
  const chatsStore = useChatsStore();
  chatsStore.activeChat = {
    chat: {
      id: 'chat-1',
      characterId: 'c1',
      personaId: null,
      title: 'The Wax Seal',
      ribbon: null,
      status: 'in_progress',
      providerId: null,
      modelId: null,
      presetId: null,
      contextBudgetTokens: null,
      lastMessageAt: NOW,
      lastMessagePreview: null,
      createdAt: NOW,
    },
    character: { id: 'c1', name: 'Vivienne' },
    persona: null,
    messages: [],
  } as never;
  const ChatSettingsSheet = (await import('../components/chat/ChatSettingsSheet.vue')).default;
  const wrapper = mount(
    host('<div><ChatSettingsSheet :open="true" @close="closed += 1" /></div>', {
      ChatSettingsSheet,
    }),
    {
      data: () => ({ closed: 0 }),
      global: { plugins: [vaporInteropPlugin] },
      attachTo: document.body,
    },
  );
  await flushPromises();
  return wrapper;
}

function findSaveButton(wrapper: ReturnType<typeof mount>): ReturnType<typeof wrapper.find> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Save changes');
  if (!button) throw new Error('Save button not rendered');
  return button;
}

describe('ChatSettingsSheet overrides (M4)', () => {
  beforeEach(() => {
    apiState.reset();
  });

  it('renders the model/preset/persona/budget override pickers', async () => {
    const wrapper = await mountSettingsSheet();
    expect(wrapper.find('#override-model').exists()).toBe(true);
    expect(wrapper.find('#override-preset').exists()).toBe(true);
    expect(wrapper.find('#override-persona').exists()).toBe(true);
    expect(wrapper.find('#override-budget').exists()).toBe(true);
    const modelOptions = wrapper.find('#override-model').element.querySelectorAll('option');
    expect(modelOptions[0]?.textContent).toContain('Default from settings');
    // Model catalog options arrived from the provider catalog.
    expect([...modelOptions].some((option) => option.value === 'test/model')).toBe(true);
    // Preset + persona lists arrived from their stores.
    const presetOptions = [...wrapper.find('#override-preset').element.querySelectorAll('option')];
    expect(presetOptions.some((option) => option.value === 'preset-1')).toBe(true);
    const personaOptions = [
      ...wrapper.find('#override-persona').element.querySelectorAll('option'),
    ];
    expect(personaOptions.some((option) => option.value === 'persona-1')).toBe(true);
    wrapper.unmount();
  });

  it('persists overrides through PATCH /api/chats/:id', async () => {
    const wrapper = await mountSettingsSheet();
    await wrapper.find('#override-model').setValue('test/model');
    await wrapper.find('#override-preset').setValue('preset-1');

    await findSaveButton(wrapper).trigger('click');
    await flushPromises();

    expect(apiState.updateChatCalls).toHaveLength(1);
    const call = apiState.updateChatCalls[0];
    expect(call?.id).toBe('chat-1');
    expect(call?.patch).toMatchObject({ modelId: 'test/model', presetId: 'preset-1' });
    wrapper.unmount();
  });

  it('sends null overrides when the pickers are reset to the default', async () => {
    const chatsStore = useChatsStore();
    const wrapper = await mountSettingsSheet();
    // Give the chat existing overrides, then reset them in the UI.
    const chat = chatsStore.activeChat?.chat;
    if (chat) {
      chatsStore.activeChat = {
        ...chatsStore.activeChat,
        chat: { ...chat, modelId: 'test/model', contextBudgetTokens: 4096 },
      } as never;
    }
    await wrapper.find('#override-model').setValue('');
    await wrapper.find('#override-budget').setValue('');

    await findSaveButton(wrapper).trigger('click');
    await flushPromises();

    const call = apiState.updateChatCalls[0];
    expect(call?.patch).toMatchObject({ modelId: null, contextBudgetTokens: null });
    wrapper.unmount();
  });
});
