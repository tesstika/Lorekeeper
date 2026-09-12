import type { Chat, ChatDetail, ChatMessage, ChatSummary, Persona } from '@lorekeeper/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, vaporInteropPlugin } from 'vue';
import DeliveredDot from '../components/chat/DeliveredDot.vue';
import ErrorBubble from '../components/chat/ErrorBubble.vue';
import MessageBody from '../components/chat/MessageBody.vue';
import MessageItem from '../components/chat/MessageItem.vue';
import MessageList from '../components/chat/MessageList.vue';
import StreamingCaret from '../components/chat/StreamingCaret.vue';
import VariantSwitcher from '../components/chat/VariantSwitcher.vue';
import { useChatsStore } from '../stores/chats';
import { useStreamingStore } from '../stores/streaming';
import { useUiStore } from '../stores/ui';

function host(
  template: string,
  components: Record<string, object>,
): ReturnType<typeof defineComponent> {
  return defineComponent({ components, template });
}

const NOW = '2026-09-08T12:00:00.000Z';

function variant(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    variantIndex: 0,
    isActive: true,
    text: 'First words.',
    finishReason: 'stop',
    isError: false,
    error: null,
    usage: null,
    createdAt: NOW,
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
    variants: [variant('v1')],
    activeVariantId: 'v1',
    attachments: [],
    usage: null,
    finishReason: 'stop',
    ...overrides,
  };
}

// -- api mock ---------------------------------------------------------------
interface ApiCallLog {
  sendMessage: unknown[];
  deleteMessage: unknown[];
  editMessage: unknown[];
  activate: unknown[];
  getChat: unknown[];
}

const apiState = vi.hoisted(() => {
  const calls: ApiCallLog = {
    sendMessage: [],
    deleteMessage: [],
    editMessage: [],
    activate: [],
    getChat: [],
  };
  return {
    calls,
    chatDetail: null as unknown,
    reset(): void {
      calls.sendMessage = [];
      calls.deleteMessage = [];
      calls.editMessage = [];
      calls.activate = [];
      calls.getChat = [];
      this.chatDetail = null;
    },
  };
});

vi.mock('@/api', () => ({
  ApiError: class ApiError extends Error {
    code = 'http_error';
    statusCode = 400;
  },
  api: {
    getChats: async () => [] as ChatSummary[],
    getChat: async (id: string) => {
      apiState.calls.getChat.push(id);
      return apiState.chatDetail as ChatDetail;
    },
    createChat: async () => {
      throw new Error('not used');
    },
    updateChat: async () => {
      throw new Error('not used');
    },
    deleteChat: async () => ({ ok: true }),
    sendMessage: async (...args: unknown[]) => {
      apiState.calls.sendMessage.push(args);
      return {
        message: message({
          id: 'sent1',
          seq: 2,
          role: 'user',
          groupId: null,
          variants: [variant('sent1', { text: 'Hello there' })],
          activeVariantId: 'sent1',
        }),
      };
    },
    editMessage: async (...args: unknown[]) => {
      apiState.calls.editMessage.push(args);
      return { message: message(), truncatedSeq: null };
    },
    deleteMessage: async (...args: unknown[]) => {
      apiState.calls.deleteMessage.push(args);
      return { deletedIds: ['m1'] };
    },
    activateVariant: async (...args: unknown[]) => {
      apiState.calls.activate.push(args);
      return { message: message() };
    },
    uploadAttachment: async () => ({
      id: 'att1',
      url: '/media/att1.png',
      width: 1,
      height: 1,
      mimeType: 'image/png',
      sizeBytes: 1,
      originalName: 'wax-seal.png',
    }),
  },
}));

const sseState = vi.hoisted(() => ({
  handler: null as ((...args: unknown[]) => void) | null,
  captured: {} as { chatId: string; targetMessageId: string | null; signal: AbortSignal },
  release: () => {},
  fail: false,
}));

vi.mock('@/api/sse', () => ({
  streamGeneration: async (
    chatId: string,
    targetMessageId: string | null,
    handlers: { onEvent: (...args: unknown[]) => void },
    signal: AbortSignal,
  ) => {
    sseState.captured = { chatId, targetMessageId, signal };
    sseState.handler = handlers.onEvent;
    if (sseState.fail) throw new Error('boom');
    await new Promise<void>((resolve) => {
      sseState.release = resolve;
    });
  },
}));

beforeEach(() => {
  setActivePinia(createPinia());
  apiState.reset();
  sseState.handler = null;
  sseState.fail = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Leaf components
// ---------------------------------------------------------------------------

describe('StreamingCaret', () => {
  it('renders the blinking caret bar with the configured interval', () => {
    const Host = host('<div><StreamingCaret :blink-ms="750" /></div>', { StreamingCaret });
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });
    const caret = wrapper.find('.lk-caret');
    expect(caret.exists()).toBe(true);
    expect(caret.attributes('style')).toContain('--lk-caret-blink: 750ms');
  });
});

describe('DeliveredDot', () => {
  it('blinks for exactly blinks × interval, then removes itself', async () => {
    vi.useFakeTimers();
    const Host = host('<div><DeliveredDot tone="stop" :blink-ms="100" :blinks="3" /></div>', {
      DeliveredDot,
    });
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });
    expect(wrapper.find('.lk-delivered-stop').exists()).toBe(true);
    vi.advanceTimersByTime(100 * 3 + 700);
    await flushPromises();
    expect(wrapper.find('.lk-delivered').exists()).toBe(false);
  });

  it('uses the amber tone for aborted streams', () => {
    const Host = host('<div><DeliveredDot tone="aborted" /></div>', { DeliveredDot });
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });
    expect(wrapper.find('.lk-delivered-aborted').exists()).toBe(true);
  });
});

describe('VariantSwitcher', () => {
  it('shows the n/N label and emits prev/next from buttons and keyboard', async () => {
    const Host = host(
      '<div><VariantSwitcher :index="1" :count="3" @prev="events.push(\'prev\')" @next="events.push(\'next\')" /></div>',
      { VariantSwitcher },
    );
    const wrapper = mount(Host, {
      data: () => ({ events: [] as string[] }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('2 / 3');
    await wrapper.find('button[aria-label="Previous variant"]').trigger('click');
    await wrapper.find('button[aria-label="Next variant"]').trigger('click');
    await wrapper.find('div[role="group"]').trigger('keydown.left');
    await wrapper.find('div[role="group"]').trigger('keydown.right');
    expect((wrapper.vm as unknown as { events: string[] }).events).toEqual([
      'prev',
      'next',
      'prev',
      'next',
    ]);
  });
});

describe('ErrorBubble (§6.8)', () => {
  it('renders a human title, collapsible details and Retry/Delete actions', async () => {
    vi.useFakeTimers();
    const Host = host(
      `<div><ErrorBubble :error="error" can-retry @retry="events.push('retry')" @delete="events.push('delete')" /></div>`,
      { ErrorBubble },
    );
    const wrapper = mount(Host, {
      data: () => ({
        events: [] as string[],
        error: {
          code: 'rate_limited',
          message: 'Too many requests, slow down.',
          statusCode: 429,
          retryAfterMs: 2000,
        },
      }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('Rate limited');
    // Countdown blocks retry initially…
    const retry = () => wrapper.find('button[aria-label="Retry reply"]');
    expect(retry().attributes('disabled')).toBeDefined();
    // …then releases when the retryAfterMs countdown elapses.
    vi.advanceTimersByTime(2100);
    await flushPromises();
    expect(retry().attributes('disabled')).toBeUndefined();
    await retry().trigger('click');
    expect((wrapper.vm as unknown as { events: string[] }).events).toContain('retry');

    await wrapper.find('button[aria-label="Delete message"]').trigger('click');
    expect((wrapper.vm as unknown as { events: string[] }).events).toContain('delete');

    const detailsButton = wrapper.find('button[aria-label="Toggle error details"]');
    await detailsButton.trigger('click');
    expect(wrapper.text()).toContain('Too many requests, slow down.');
    expect(wrapper.text()).toContain('HTTP 429');
  });
});

// ---------------------------------------------------------------------------
// MessageBody: settled markdown vs streaming caret mode
// ---------------------------------------------------------------------------

describe('MessageBody', () => {
  it('renders settled markdown through the sanitized pipeline', () => {
    const Host = host('<div><MessageBody :text="text" /></div>', { MessageBody });
    const wrapper = mount(Host, {
      data: () => ({ text: '*Narration.*\n\n"Speech." <script>alert(1)</script>' }),
      global: { plugins: [vaporInteropPlugin] },
    });
    const body = wrapper.find('[data-testid="settled-body"]');
    expect(body.exists()).toBe(true);
    expect(body.html()).not.toContain('<script>');
    expect(body.find('p.lk-narration').exists()).toBe(true);
    expect(body.find('p.lk-dialogue').exists()).toBe(true);
  });

  it('appends fade-in runs with a trailing caret while streaming', async () => {
    const Host = host('<div><MessageBody :text="text" streaming :caret-blink-ms="500" /></div>', {
      MessageBody,
    });
    const wrapper = mount(Host, {
      data: () => ({ text: '' }),
      global: { plugins: [vaporInteropPlugin] },
    });
    const streamingBody = wrapper.find('[data-testid="streaming-body"]');
    expect(streamingBody.exists()).toBe(true);
    expect(streamingBody.find('.lk-caret').exists()).toBe(true);

    await wrapper.setData({ text: 'A ghost' });
    await wrapper.setData({ text: 'A ghost of a smile' });
    await flushPromises();
    const runs = wrapper.findAll('.lk-fade-in');
    expect(runs.length).toBeGreaterThanOrEqual(2);
    // The caret stays the LAST node — it tracks the end of the text.
    const lastChild = streamingBody.element.lastElementChild;
    expect(lastChild?.classList.contains('lk-caret')).toBe(true);
  });

  it('switches to the settled renderer when the stream finishes', async () => {
    const Host = host('<div><MessageBody :text="text" :streaming="streaming" /></div>', {
      MessageBody,
    });
    const wrapper = mount(Host, {
      data: () => ({ text: 'Done text', streaming: true }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.find('[data-testid="streaming-body"]').exists()).toBe(true);
    await wrapper.setData({ streaming: false });
    await flushPromises();
    expect(wrapper.find('[data-testid="settled-body"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="settled-body"]').text()).toContain('Done text');
  });
});

// ---------------------------------------------------------------------------
// MessageItem: role-polymorphic actions, edit flows, delete confirms, swipes
// ---------------------------------------------------------------------------

describe('MessageItem', () => {
  it('renders character messages with the Character badge and character name', () => {
    const Host = host(
      '<div><MessageItem :message="message" display-name="Lady Vivienne" avatar-path="null" tone="character" :can-regenerate="true" /></div>',
      { MessageItem },
    );
    const wrapper = mount(Host, {
      data: () => ({ message: message() }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('Lady Vivienne');
    expect(wrapper.text()).toContain('Character');
    expect(wrapper.find('[aria-label="Regenerate reply"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Edit message"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Copy message"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Delete message"]').exists()).toBe(true);
  });

  it('renders the persona avatar for user turns, initials only when absent', () => {
    const withAvatar = mount(
      host(
        '<div><MessageItem :message="message" display-name="Mike" avatar-path="/media/mike.png" tone="user" /></div>',
        { MessageItem },
      ),
      {
        data: () => ({ message: message({ role: 'user', groupId: null, activeVariantId: 'v1' }) }),
        global: { plugins: [vaporInteropPlugin] },
      },
    );
    const img = withAvatar.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/media/mike.png');
    expect(img.attributes('alt')).toBe('Mike');
    withAvatar.unmount();

    const withoutAvatar = mount(
      host(
        '<div><MessageItem :message="message" display-name="Mike" :avatar-path="null" tone="user" /></div>',
        { MessageItem },
      ),
      {
        data: () => ({ message: message({ role: 'user', groupId: null, activeVariantId: 'v1' }) }),
        global: { plugins: [vaporInteropPlugin] },
      },
    );
    expect(withoutAvatar.find('img').exists()).toBe(false);
    expect(withoutAvatar.text()).toContain('M');
    withoutAvatar.unmount();
  });

  it('offers Save (default) and Save & regenerate after for user edits (D8)', async () => {
    const Host = host(
      '<div><MessageItem :message="message" display-name="Julian" avatar-path="null" tone="user" @save="saved.push($event)" /></div>',
      { MessageItem },
    );
    const wrapper = mount(Host, {
      data: () => ({
        saved: [] as Array<{ text: string; regenerateAfter: boolean }>,
        message: message({ role: 'user', groupId: null, activeVariantId: 'v1' }),
      }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await wrapper.find('[aria-label="Edit message"]').trigger('click');
    const textarea = wrapper.find('textarea[aria-label="Edit message text"]');
    await textarea.setValue('I step from the shadows.');
    // "Save" is the primary/default action.
    const buttons = wrapper.findAll('button');
    const save = buttons.find((b) => b.text() === 'Save');
    const saveRegen = buttons.find((b) => b.text().includes('Save & regenerate after'));
    expect(save).toBeDefined();
    expect(saveRegen).toBeDefined();

    await saveRegen?.trigger('click');
    const saved = (
      wrapper.vm as unknown as { saved: Array<{ text: string; regenerateAfter: boolean }> }
    ).saved;
    expect(saved).toEqual([{ text: 'I step from the shadows.', regenerateAfter: true }]);
  });

  it('confirms user-message deletes with the follow-up checkbox (D7)', async () => {
    const Host = host(
      '<div><MessageItem :message="message" display-name="Julian" avatar-path="null" tone="user" @delete="(withReplies) => deleted.push(withReplies)" /></div>',
      { MessageItem },
    );
    const wrapper = mount(Host, {
      data: () => ({
        deleted: [] as boolean[],
        message: message({ role: 'user', groupId: null }),
      }),
      global: { plugins: [vaporInteropPlugin] },
    });
    const ui = useUiStore();
    await wrapper.find('[aria-label="Delete message"]').trigger('click');
    expect(ui.pendingConfirm?.checkboxLabel).toContain('Also delete the reply');
    // Accepting with the checkbox ON removes the following reply too.
    ui.settleConfirm(true, true);
    await flushPromises();
    expect((wrapper.vm as unknown as { deleted: boolean[] }).deleted).toEqual([true]);
  });

  it('copies raw markdown to the clipboard with a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const Host = host(
      '<div><MessageItem :message="message" display-name="Vivienne" avatar-path="null" tone="character" /></div>',
      {
        MessageItem,
      },
    );
    const wrapper = mount(Host, {
      data: () => ({
        message: message({ variants: [variant('v1', { text: '*raw* "markdown"' })] }),
      }),
      global: { plugins: [vaporInteropPlugin] },
    });
    const ui = useUiStore();
    await wrapper.find('[aria-label="Copy message"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('*raw* "markdown"');
    expect(ui.toasts.some((toast) => toast.message === 'Copied')).toBe(true);
  });

  it('exposes the variant switcher for multi-variant groups and emits activate', async () => {
    const Host = host(
      '<div><MessageItem :message="message" display-name="Vivienne" avatar-path="null" tone="character" @activate="(id) => activated.push(id)" /></div>',
      { MessageItem },
    );
    const wrapper = mount(Host, {
      data: () => ({
        activated: [] as string[],
        message: message({
          variants: [
            variant('v1'),
            variant('v2', { variantIndex: 1, isActive: true, text: 'Second take.' }),
          ],
          activeVariantId: 'v2',
        }),
      }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('2 / 2');
    await wrapper.find('button[aria-label="Previous variant"]').trigger('click');
    expect((wrapper.vm as unknown as { activated: string[] }).activated).toEqual(['v1']);
  });

  it('renders the error bubble for error variants instead of prose', () => {
    const Host = host(
      '<div><MessageItem :message="message" display-name="Vivienne" avatar-path="null" tone="character" /></div>',
      {
        MessageItem,
      },
    );
    const wrapper = mount(Host, {
      data: () => ({
        message: message({
          isError: true,
          error: { code: 'network_error', message: 'Could not reach provider' },
          finishReason: 'error',
          variants: [
            variant('v1', {
              text: '',
              isError: true,
              finishReason: 'error',
              error: { code: 'network_error', message: 'x' },
            }),
          ],
        }),
      }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Connection failed');
    expect(wrapper.find('[aria-label="Retry reply"]').exists()).toBe(true);
    // Error bubbles are not editable (§6.8).
    expect(wrapper.find('[aria-label="Edit message"]').exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MessageList scroll manager (§6.3/§6.5)
// ---------------------------------------------------------------------------

describe('MessageList scroll manager', () => {
  function stubScrollArea(wrapper: ReturnType<typeof mount>) {
    const el = wrapper.find('[data-testid="message-list"]').element as HTMLElement;
    let scrollTopValue = 600;
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'scrollTop', {
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
      configurable: true,
    });
    el.scrollTo = ((options: { top: number }) => {
      scrollTopValue = options.top;
    }) as typeof el.scrollTo;
    return {
      el,
      get scrollTop() {
        return scrollTopValue;
      },
      set scrollTop(value: number) {
        scrollTopValue = value;
      },
    };
  }

  beforeEach(() => {
    // Deterministic scheduling: run rAF callbacks synchronously.
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof requestAnimationFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays pinned to the bottom and follows new content', async () => {
    const Host = host(
      '<div><MessageList :watch-key="tick"><p v-for="i in 5" :key="i">line</p></MessageList></div>',
      {
        MessageList,
      },
    );
    const wrapper = mount(Host, {
      data: () => ({ tick: 0 }),
      global: { plugins: [vaporInteropPlugin] },
    });
    // Let the deferred mount-time scroll settle against real (empty) metrics.
    await flushPromises();
    const area = stubScrollArea(wrapper);
    await wrapper.setData({ tick: 1 });
    await flushPromises();
    expect(area.scrollTop).toBe(1000);
  });

  it('detaches when the user scrolls up >120px and stops yanking (no-yank rule)', async () => {
    const Host = host(
      '<div><MessageList :watch-key="tick"><p v-for="i in 5" :key="i">line</p></MessageList></div>',
      {
        MessageList,
      },
    );
    const wrapper = mount(Host, {
      data: () => ({ tick: 0 }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await flushPromises();
    const area = stubScrollArea(wrapper);
    area.scrollTop = 100; // distance = 1000 - 100 - 400 = 500 > 120
    await area.el.dispatchEvent(new Event('scroll'));
    await wrapper.setData({ tick: 1 });
    await flushPromises();
    expect(area.scrollTop).toBe(100);

    // Scrolling back near the bottom re-attaches the pin.
    area.scrollTop = 590; // distance = 10 <= 40
    await area.el.dispatchEvent(new Event('scroll'));
    await wrapper.setData({ tick: 2 });
    await flushPromises();
    expect(area.scrollTop).toBe(1000);
  });

  it('never auto-scrolls when the autoScroll setting is off', async () => {
    const Host = host(
      '<div><MessageList :watch-key="tick" :auto-scroll="false"><p v-for="i in 5" :key="i">line</p></MessageList></div>',
      {
        MessageList,
      },
    );
    const wrapper = mount(Host, {
      data: () => ({ tick: 0 }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await flushPromises();
    const area = stubScrollArea(wrapper);
    await wrapper.setData({ tick: 1 });
    await flushPromises();
    expect(area.scrollTop).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// Streaming store → chats store integration (SSE cache writes)
// ---------------------------------------------------------------------------

describe('streaming store cache writes', () => {
  function seedChat(): ChatDetail {
    const chat = {
      id: 'c1',
      characterId: 'ch1',
      personaId: null,
      title: 'Vivienne',
      ribbon: null,
      status: 'in_progress',
      providerId: null,
      modelId: null,
      presetId: null,
      lastMessageAt: NOW,
      lastMessagePreview: null,
      createdAt: NOW,
    } as Chat;
    return {
      chat,
      character: {
        id: 'ch1',
        name: 'Lady Vivienne',
        tagline: null,
        tags: [],
        avatarPath: null,
        description: '',
        creatorNotes: '',
        extensions: {},
        personality: '',
        behavior: '',
        communicationStyle: '',
        likes: '',
        dislikes: '',
        backstory: '',
        scenario: '',
        exampleDialogue: '',
        firstMessage: '',
        alternateGreetings: [],
        systemExtras: '',
        jailbreak: '',
        createdAt: NOW,
        updatedAt: NOW,
      },
      persona: null as Persona | null,
      messages: [message({ id: 'v0', seq: 0, groupId: 'g0', isGreeting: true })],
    };
  }

  it('inserts the placeholder, appends deltas and finalizes on done', async () => {
    apiState.chatDetail = seedChat();
    const chats = useChatsStore();
    await chats.openChat('c1');
    expect(chats.activeChat?.messages).toHaveLength(1);

    const streaming = useStreamingStore();
    const run = streaming.start({ chatId: 'c1' });
    await flushPromises();
    expect(sseState.captured.chatId).toBe('c1');

    sseState.handler?.({ type: 'meta', messageId: 'v9', groupId: 'g9', seq: 2 });
    sseState.handler?.({ type: 'delta', text: 'A ghost' });
    sseState.handler?.({ type: 'delta', text: ' appears.' });
    sseState.handler?.({
      type: 'done',
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 3 },
    });
    sseState.release();
    await run;
    await flushPromises();

    const messages = chats.activeChat?.messages ?? [];
    const reply = messages.find((m) => m.variants.some((v) => v.id === 'v9'));
    expect(reply).toBeDefined();
    expect(reply?.variants[0]?.text).toBe('A ghost appears.');
    expect(reply?.variants[0]?.finishReason).toBe('stop');
    expect(streaming.isStreaming).toBe(false);
  });

  it('regenerate writes the new variant into the existing group', async () => {
    apiState.chatDetail = seedChat();
    const chats = useChatsStore();
    await chats.openChat('c1');
    const streaming = useStreamingStore();
    // The greeting group (g0) is the regenerate target.
    const run = streaming.start({ chatId: 'c1', targetMessageId: 'v0' });
    await flushPromises();
    expect(sseState.captured.targetMessageId).toBe('v0');

    sseState.handler?.({ type: 'meta', messageId: 'v9', groupId: 'g0', seq: 0 });
    sseState.handler?.({ type: 'delta', text: 'Second take.' });
    sseState.release();
    await run;

    const group = chats.activeChat?.messages.find((m) => m.groupId === 'g0');
    expect(group?.variants).toHaveLength(2);
    expect(group?.activeVariantId).toBe('v9');
    expect(group?.variants.find((v) => v.id === 'v9')?.isActive).toBe(true);
    expect(group?.variants.find((v) => v.id === 'v1')?.isActive).toBe(false);
  });
});
