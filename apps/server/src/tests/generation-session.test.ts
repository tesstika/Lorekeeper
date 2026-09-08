import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SseEvent } from '@lorekeeper/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { isGenerating, runGenerationSession } from '../generation/session';
import type { SseWriter } from '../generation/sseWriter';
import { providerRegistry, setProviderForTesting } from '../providers';
import type { LlmProvider, StreamEvent } from '../providers/types';
import { ProviderError } from '../providers/types';
import { KeyStore } from '../services/keyStore';
import { setModelCache } from '../services/settingsRepo';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-gen-'));
const secretKeyPath = path.join(dataDir, 'secret.key');

let app: Awaited<ReturnType<typeof buildApp>>;
let keyStore: KeyStore;
let chatId: string;
const originalProvider = providerRegistry.openrouter;

beforeAll(async () => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = secretKeyPath;
  app = await buildApp({ dataDir });
  await app.ready();
  keyStore = new KeyStore(app.db);
  keyStore.setKey('openrouter', 'sk-or-v1-testkey-1234567890');

  // Configure the engine: provider + model defaults with a cached catalog.
  await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    payload: { globalDefaults: { providerId: 'openrouter', modelId: 'test/model' } },
  });
  setModelCache(app.db, 'openrouter', {
    fetchedAt: new Date().toISOString(),
    models: [
      {
        id: 'test/model',
        name: 'Test Model',
        contextLength: 32_000,
        inputModalities: ['text', 'image'],
      },
    ],
  });

  const character = await app.inject({
    method: 'POST',
    url: '/api/characters',
    payload: { name: 'Vivienne', firstMessage: '*She waits.* "Speak."' },
  });
  const characterId = (character.json() as { id: string }).id;
  const chat = await app.inject({ method: 'POST', url: '/api/chats', payload: { characterId } });
  chatId = (chat.json() as { chat: { id: string } }).chat.id;
});

afterAll(async () => {
  setProviderForTesting('openrouter', originalProvider);
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows WAL handles — best-effort cleanup.
  }
});

function fakeWriter() {
  const events: SseEvent[] = [];
  const comments: string[] = [];
  let closed = false;
  let closeHandler: (() => void) | null = null;
  const writer: SseWriter = {
    writeEvent(event) {
      events.push(event);
    },
    writeComment(comment) {
      comments.push(comment);
    },
    end() {
      closed = true;
    },
    onClientClose(handler) {
      closeHandler = handler;
      if (closed) handler();
    },
    isClosed() {
      return closed;
    },
  };
  return {
    writer,
    events,
    comments,
    close() {
      closed = true;
      closeHandler?.();
    },
  };
}

function scriptProvider(script: (signal: AbortSignal) => AsyncGenerator<StreamEvent>): LlmProvider {
  return {
    ...originalProvider,
    id: 'openrouter',
    label: 'Scripted',
    baseUrl: 'mock://test',
    async *streamChat(_request, _apiKey, signal) {
      yield* script(signal);
    },
  };
}

async function sendUserMessage(text: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/chats/${chatId}/messages`,
    payload: { text },
  });
  expect(response.statusCode).toBe(201);
}

async function chatMessages(): Promise<Array<Record<string, unknown>>> {
  const detail = await app.inject({ method: 'GET', url: `/api/chats/${chatId}` });
  return (detail.json() as { messages: Array<Record<string, unknown>> }).messages;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('SSE generation session', () => {
  afterEach(() => {
    setProviderForTesting('openrouter', originalProvider);
  });

  it('streams meta/delta/done and persists the final variant', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* () {
        yield { type: 'delta', text: 'A ghost' };
        yield { type: 'delta', text: ' of a smile…' };
        yield {
          type: 'done',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 7, costUsd: 0.01 },
        };
      }),
    );
    await sendUserMessage('I knock twice.');
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
    });

    expect(outcome.status).toBe('completed');
    const [meta, ...rest] = harness.events;
    expect(meta?.type).toBe('meta');
    if (meta?.type === 'meta') {
      expect(meta.seq).toBe(2);
      expect(meta.groupId).toBeTruthy();
    }
    expect(rest.filter((event) => event.type === 'delta')).toHaveLength(2);
    const done = rest.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.finishReason).toBe('stop');
      expect(done.usage?.completionTokens).toBe(7);
    }

    const messages = await chatMessages();
    const reply = messages.at(-1) as {
      role: string;
      finishReason: string | null;
      usage: { promptTokens: number } | null;
      variants: Array<{ text: string; isActive: boolean }>;
    };
    expect(reply.role).toBe('assistant');
    expect(reply.finishReason).toBe('stop');
    expect(reply.usage?.promptTokens).toBe(20);
    expect(reply.variants[0]?.text).toBe('A ghost of a smile…');
    expect(reply.variants[0]?.isActive).toBe(true);
  });

  it('emits a heartbeat comment during long streams', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* () {
        yield { type: 'delta', text: 'slow…' };
        await sleep(40);
        yield { type: 'done', finishReason: 'stop' };
      }),
    );
    await sendUserMessage('heartbeat probe');
    const harness = fakeWriter();
    await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
      heartbeatMs: 15,
    });
    expect(harness.comments).toContain('ping');
  });

  it('persists partial text with finishReason aborted when the client stops', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* (signal) {
        yield { type: 'delta', text: 'partial ' };
        yield { type: 'delta', text: 'text' };
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { type: 'done', finishReason: 'aborted' };
      }),
    );
    await sendUserMessage('stop probe');
    const harness = fakeWriter();
    const runPromise = runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
    });
    await sleep(10);
    expect(harness.events.filter((event) => event.type === 'delta')).toHaveLength(2);
    harness.close(); // client Stop → request.raw close
    const outcome = await runPromise;

    expect(outcome.status).toBe('aborted');
    expect(outcome.finishReason).toBe('aborted');
    // No `done` frame reaches the (already closed) client socket.
    expect(harness.events.some((event) => event.type === 'done')).toBe(false);

    const messages = await chatMessages();
    const reply = messages.at(-1) as {
      finishReason: string | null;
      isError: boolean;
      variants: Array<{ text: string }>;
    };
    expect(reply.finishReason).toBe('aborted');
    expect(reply.isError).toBe(false);
    expect(reply.variants[0]?.text).toBe('partial text');
  });

  it('maps provider errors to the full ChatError payload and an error frame (D10)', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* () {
        yield { type: 'delta', text: 'begun…' };
        throw new ProviderError('rate_limited', 'Slow down, scribe.', {
          statusCode: 429,
          retryAfterMs: 1500,
        });
      }),
    );
    await sendUserMessage('error probe');
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
    });

    expect(outcome.status).toBe('error');
    const errorEvent = harness.events.at(-1);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('rate_limited');
      expect(errorEvent.statusCode).toBe(429);
      expect(errorEvent.retryAfterMs).toBe(1500);
      expect(errorEvent.providerId).toBe('openrouter');
      expect(errorEvent.modelId).toBe('test/model');
    }

    const messages = await chatMessages();
    const reply = messages.at(-1) as {
      finishReason: string | null;
      isError: boolean;
      error: { code: string; statusCode?: number; retryAfterMs?: number } | null;
      variants: Array<{ text: string }>;
    };
    expect(reply.isError).toBe(true);
    expect(reply.finishReason).toBe('error');
    expect(reply.error?.code).toBe('rate_limited');
    expect(reply.error?.statusCode).toBe(429);
    expect(reply.error?.retryAfterMs).toBe(1500);
    expect(reply.variants[0]?.text).toBe('begun…');
  });

  it('persists mid-stream error frames', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* () {
        yield { type: 'delta', text: 'half' };
        yield {
          type: 'error',
          code: 'upstream_error',
          message: 'Provider exploded',
          statusCode: 503,
        };
      }),
    );
    await sendUserMessage('mid-stream probe');
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
    });
    expect(outcome.status).toBe('error');
    const errorEvent = harness.events.at(-1);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.statusCode).toBe(503);
      expect(errorEvent.message).toBe('Provider exploded');
    }
  });

  it('aborts and reports an idle_timeout when the provider stalls (D-P1)', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* (signal) {
        yield { type: 'delta', text: 'first byte' };
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        yield { type: 'done', finishReason: 'stop' };
      }),
    );
    await sendUserMessage('idle probe');
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
      idleTimeoutMs: 60,
      idleCheckMs: 20,
    });
    expect(outcome.status).toBe('error');
    const errorEvent = harness.events.at(-1);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('idle_timeout');
    }
    const messages = await chatMessages();
    const reply = messages.at(-1) as { isError: boolean; error: { code: string } | null };
    expect(reply.isError).toBe(true);
    expect(reply.error?.code).toBe('idle_timeout');
  });

  it('reports no_key before any traffic when the provider key is missing', async () => {
    setProviderForTesting(
      'unorouter',
      scriptProvider(async function* () {
        yield { type: 'done', finishReason: 'stop' };
      }),
    );
    await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { providerId: 'unorouter' },
    });
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
    });
    expect(outcome.status).toBe('error');
    const errorEvent = harness.events.at(-1);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('no_key');
    }
    await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { providerId: null },
    });
  });

  it('reports no_model_configured when zero defaults exist (D-S1)', async () => {
    const character = await app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { name: 'No Config' },
    });
    const characterId = (character.json() as { id: string }).id;
    const chat = await app.inject({ method: 'POST', url: '/api/chats', payload: { characterId } });
    const bareChatId = (chat.json() as { chat: { id: string } }).chat.id;

    // Chat has no overrides; wipe the global defaults for this probe.
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { globalDefaults: { providerId: null, modelId: null } },
    });
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId: bareChatId,
    });
    expect(outcome.status).toBe('error');
    const errorEvent = harness.events.at(-1);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('no_model_configured');
    }
    // Restore defaults for later tests.
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { globalDefaults: { providerId: 'openrouter', modelId: 'test/model' } },
    });
  });

  it('enforces the single-flight guard with 409 on the route', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* (signal) {
        await gate;
        if (signal.aborted) {
          yield { type: 'done', finishReason: 'aborted' };
          return;
        }
        yield { type: 'delta', text: 'after gate' };
        yield { type: 'done', finishReason: 'stop' };
      }),
    );
    await sendUserMessage('single-flight probe');

    const first = app.inject({ method: 'POST', url: `/api/chats/${chatId}/generate` });
    // Wait until the session has claimed the chat slot.
    for (let i = 0; i < 100 && !isGenerating(chatId); i += 1) await sleep(5);
    expect(isGenerating(chatId)).toBe(true);

    const second = await app.inject({ method: 'POST', url: `/api/chats/${chatId}/generate` });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { code: string }).code).toBe('generation_in_progress');

    release();
    const firstResponse = await first;
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.headers['content-type']).toContain('text/event-stream');
    expect(firstResponse.body).toContain('"type":"meta"');
    expect(firstResponse.body).toContain('"type":"delta"');
    expect(firstResponse.body).toContain('"type":"done"');
    expect(isGenerating(chatId)).toBe(false);
  });

  it('regenerate adds a variant to the SAME group and activates it', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* () {
        yield { type: 'delta', text: 'variant one' };
        yield { type: 'done', finishReason: 'stop' };
      }),
    );
    await sendUserMessage('regenerate probe');
    const firstHarness = fakeWriter();
    await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: firstHarness.writer,
      chatId,
    });
    const firstMeta = firstHarness.events[0];
    expect(firstMeta?.type).toBe('meta');

    const messages = await chatMessages();
    const assistant = messages.at(-1) as {
      id: string;
      groupId: string | null;
      variants: unknown[];
    };
    expect(assistant.groupId).toBeTruthy();
    expect(assistant.variants).toHaveLength(1);

    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* () {
        yield { type: 'delta', text: 'variant two' };
        yield { type: 'done', finishReason: 'stop' };
      }),
    );
    const secondHarness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: secondHarness.writer,
      chatId,
      targetMessageId: assistant.id,
    });
    expect(outcome.status).toBe('completed');
    const secondMeta = secondHarness.events[0];
    expect(secondMeta?.type).toBe('meta');
    if (firstMeta?.type === 'meta' && secondMeta?.type === 'meta') {
      expect(secondMeta.groupId).toBe(firstMeta.groupId);
      expect(secondMeta.seq).toBe(firstMeta.seq);
      expect(secondMeta.messageId).not.toBe(firstMeta.messageId);
    }

    const after = (await chatMessages()).at(-1) as {
      activeVariantId: string | null;
      variants: Array<{ text: string; isActive: boolean }>;
    };
    expect(after.variants).toHaveLength(2);
    expect(after.activeVariantId).toBe(secondMeta?.type === 'meta' ? secondMeta.messageId : null);
    expect(after.variants.find((v) => v.text === 'variant two')?.isActive).toBe(true);
    expect(after.variants.find((v) => v.text === 'variant one')?.isActive).toBe(false);
  });

  it('regenerates the greeting like any assistant group', async () => {
    setProviderForTesting(
      'openrouter',
      scriptProvider(async function* () {
        yield { type: 'delta', text: 'regreeted' };
        yield { type: 'done', finishReason: 'stop' };
      }),
    );
    const messages = await chatMessages();
    const greeting = messages[0] as { id: string; groupId: string | null };
    expect(greeting.groupId).toBeTruthy();
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
      targetMessageId: greeting.id,
    });
    expect(outcome.status).toBe('completed');
    const after = await chatMessages();
    const greetingGroup = after.find(
      (m) => (m as { groupId: string | null }).groupId === greeting.groupId,
    ) as {
      variants: Array<{ text: string; isActive: boolean }>;
    };
    expect(greetingGroup.variants.some((v) => v.text === 'regreeted')).toBe(true);
  });

  it('rejects regenerating user messages with an invalid_target error', async () => {
    const messages = await chatMessages();
    const userMessage = messages.find((m) => (m as { role: string }).role === 'user') as {
      id: string;
    };
    const harness = fakeWriter();
    const outcome = await runGenerationSession({
      db: app.db,
      dataDir,
      keyStore,
      writer: harness.writer,
      chatId,
      targetMessageId: userMessage.id,
    });
    expect(outcome.status).toBe('error');
    const errorEvent = harness.events.at(-1);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('invalid_target');
    }
  });
});
