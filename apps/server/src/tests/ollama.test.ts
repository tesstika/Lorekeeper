import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChatRequest, OllamaPullProgressEvent, StreamEvent } from '@lorekeeper/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import {
  curatedOllamaModelInfos,
  fetchOllamaStatus,
  isOllamaModelPulled,
  OLLAMA_CURATED_MODELS,
  ollamaProvider,
  ollamaTagsMatch,
  pullOllamaModel,
} from '../providers/ollama';
import { toWireBody } from '../providers/openaiCompat';
import type { ProviderError } from '../providers/types';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-ollama-'));
const secretKeyPath = path.join(dataDir, 'secret.key');

/** noUncheckedIndexedAccess-safe curated tag lookup. */
const curatedTag = (index: number): string => OLLAMA_CURATED_MODELS[index]?.tag ?? '';

let app: Awaited<ReturnType<typeof buildApp>>;
let chatId: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = secretKeyPath;
  app = await buildApp({ dataDir });
  await app.ready();

  // Engine configured for Ollama with the first curated model.
  await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    payload: {
      globalDefaults: { providerId: 'ollama', modelId: curatedTag(0) },
    },
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
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows WAL handles — best-effort cleanup.
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// fetch stubbing: dispatch on URL fragment so one stub serves version, tags,
// pull and chat/completions routes.
// ---------------------------------------------------------------------------

function stubFetch(routes: Record<string, () => Response>): ReturnType<typeof vi.fn> {
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [fragment, handler] of Object.entries(routes)) {
      if (url.includes(fragment)) return handler();
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textStreamResponse(text: string, contentType: string): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': contentType } });
}

const VERSION_ROUTE = () => jsonResponse({ version: '0.12.6' });

const TAGS_ROUTE = (names: Array<{ name: string; size: number }>) => () =>
  jsonResponse({ models: names.map((entry) => ({ ...entry, model: entry.name, digest: 'x' })) });

const PULL_ROUTE = (lines: unknown[]) => () =>
  textStreamResponse(
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'application/x-ndjson',
  );

const CHAT_NATIVE_ROUTE = () => () => {
  const frames = [
    { message: { role: 'assistant', content: '"Hello."' }, done: false },
    { done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 3 },
  ];
  return textStreamResponse(
    `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`,
    'application/x-ndjson',
  );
};

// ---------------------------------------------------------------------------
// Provider unit behavior
// ---------------------------------------------------------------------------

describe('ollama wire format (num_ctx)', () => {
  it('forwards num_ctx as options.num_ctx', () => {
    const body = toWireBody({ ...baseRequest(), numCtx: 16_384 }, true) as Record<string, unknown>;
    expect(body.options).toEqual({ num_ctx: 16_384 });
  });

  it('omits options when numCtx is unset or non-positive', () => {
    const unset = toWireBody(baseRequest(), true) as Record<string, unknown>;
    expect('options' in unset).toBe(false);
    const zero = toWireBody({ ...baseRequest(), numCtx: 0 }, true) as Record<string, unknown>;
    expect('options' in zero).toBe(false);
  });
});

function baseRequest(): ChatRequest {
  return {
    model: 'test/tag',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.85,
    topP: 0.92,
    maxTokens: 512,
    frequencyPenalty: 0.1,
    presencePenalty: 0.2,
    stopSequences: [],
  };
}

describe('ollamaTagsMatch', () => {
  it('matches exact tags', () => {
    expect(ollamaTagsMatch('a/b:Q4_K_M', 'a/b:Q4_K_M')).toBe(true);
  });

  it('matches a curated tag without suffix against its :latest variant', () => {
    expect(ollamaTagsMatch('a/b:latest', 'a/b')).toBe(true);
    expect(ollamaTagsMatch('a/b', 'a/b:latest')).toBe(false);
  });

  it('matches a curated tag against a manually-pulled quantifier suffix (real-world case)', () => {
    // Live daemon 2026-09-12: the Mistral curated tag was pulled with an
    // explicit `:Q4_K_M` suffix — still recognized as the same model.
    expect(
      ollamaTagsMatch(
        'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M:Q4_K_M',
        curatedTag(0),
      ),
    ).toBe(true);
  });

  it('rejects different names', () => {
    expect(ollamaTagsMatch('a/b:Q4_K_M', 'a/c:Q4_K_M')).toBe(false);
    expect(ollamaTagsMatch('a/b:Q4_K_M', 'a/b:Q5_K_M')).toBe(false);
  });
});

describe('ollamaProvider', () => {
  it('catalog is exactly the curated whitelist (static, no network)', async () => {
    const stub = stubFetch({});
    const models = await ollamaProvider.listModels('');
    expect(models.map((model) => model.id)).toEqual(
      OLLAMA_CURATED_MODELS.map((entry) => entry.tag),
    );
    expect(models).toEqual(curatedOllamaModelInfos());
    expect(stub).not.toHaveBeenCalled();
  });

  it('testConnection measures latency against /api/version', async () => {
    stubFetch({ '/api/version': VERSION_ROUTE });
    const { latencyMs } = await ollamaProvider.testConnection('');
    expect(latencyMs).toBeGreaterThanOrEqual(1);
  });

  it('testConnection maps an unreachable daemon to a ProviderError', async () => {
    stubFetch({
      '/api/version': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    await expect(ollamaProvider.testConnection('')).rejects.toMatchObject({
      code: 'network_error',
    } satisfies Partial<ProviderError>);
  });

  it('streamChat resolves the installed tag and sends num_ctx via /api/chat', async () => {
    const installedTag =
      'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M:Q4_K_M';
    const stub = stubFetch({
      '/api/tags': TAGS_ROUTE([{ name: installedTag, size: 14_333_924_655 }]),
      '/api/chat': CHAT_NATIVE_ROUTE(),
    });
    const events: StreamEvent[] = [];
    for await (const event of ollamaProvider.streamChat(
      { ...baseRequest(), model: curatedTag(0), numCtx: 8192 },
      '',
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events[0]).toEqual({ type: 'delta', text: '"Hello."' });
    expect(events.at(-1)).toEqual({
      type: 'done',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 3 },
    });
    const chatCall = (stub.mock.calls as Array<[string, RequestInit]>).find(([url]) =>
      String(url).includes('/api/chat'),
    );
    expect(chatCall).toBeDefined();
    const [url, init] = chatCall as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(String(init.body)) as {
      model?: string;
      options?: Record<string, unknown>;
    };
    expect(body.model).toBe(installedTag);
    expect(body.options).toMatchObject({ num_ctx: 8192, temperature: 0.85, num_predict: 512 });
  });

  it('streamChat keeps the requested tag when the daemon does not answer', async () => {
    const stub = stubFetch({
      '/api/tags': () => {
        throw new Error('connect ECONNREFUSED');
      },
      '/api/chat': CHAT_NATIVE_ROUTE(),
    });
    for await (const _event of ollamaProvider.streamChat(
      { ...baseRequest(), model: curatedTag(0) },
      '',
      new AbortController().signal,
    )) {
      break;
    }
    const chatCall = (stub.mock.calls as Array<[string, RequestInit]>).find(([url]) =>
      String(url).includes('/api/chat'),
    );
    const body = JSON.parse(String((chatCall as unknown as [string, RequestInit])[1].body)) as {
      model?: string;
    };
    expect(body.model).toBe(curatedTag(0));
  });

  it('streamChat converts image content parts to the native images array', async () => {
    const stub = stubFetch({ '/api/chat': CHAT_NATIVE_ROUTE() });
    for await (const _event of ollamaProvider.streamChat(
      {
        ...baseRequest(),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe' },
              { type: 'image_url', imageUrl: { url: 'data:image/png;base64,QUJD' } },
            ],
          },
        ],
      },
      '',
      new AbortController().signal,
    )) {
      break;
    }
    const chatCall = (stub.mock.calls as Array<[string, RequestInit]>).find(([url]) =>
      String(url).includes('/api/chat'),
    );
    const body = JSON.parse(String((chatCall as unknown as [string, RequestInit])[1].body)) as {
      messages?: Array<{ role: string; content: string; images?: string[] }>;
    };
    expect(body.messages?.[0]).toEqual({ role: 'user', content: 'Describe', images: ['QUJD'] });
  });

  it('streamChat surfaces Ollama error frames as StreamEvent errors', async () => {
    stubFetch({
      '/api/chat': () =>
        textStreamResponse(
          `${JSON.stringify({ error: 'request (7522 tokens) exceeds the available context size (4096 tokens)' })}\n`,
          'application/x-ndjson',
        ),
    });
    const events: StreamEvent[] = [];
    for await (const event of ollamaProvider.streamChat(
      baseRequest(),
      '',
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: 'error',
        code: 'upstream_error',
        message: 'request (7522 tokens) exceeds the available context size (4096 tokens)',
      },
    ]);
  });
});

describe('ollama daemon helpers', () => {
  it('fetchOllamaStatus reports the running version', async () => {
    stubFetch({ '/api/version': VERSION_ROUTE });
    await expect(fetchOllamaStatus()).resolves.toEqual({ running: true, version: '0.12.6' });
  });

  it('fetchOllamaStatus degrades an unreachable daemon to running:false', async () => {
    stubFetch({
      '/api/version': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    await expect(fetchOllamaStatus()).resolves.toEqual({ running: false, version: null });
  });

  it('isOllamaModelPulled cross-references /api/tags with :latest normalization', async () => {
    stubFetch({
      '/api/tags': TAGS_ROUTE([
        {
          name: 'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M:latest',
          size: 14_000_000_000,
        },
      ]),
    });
    await expect(isOllamaModelPulled(curatedTag(0))).resolves.toBe(true);
    await expect(isOllamaModelPulled(curatedTag(1))).resolves.toBe(false);
  });

  it('isOllamaModelPulled reports false when the daemon is unreachable', async () => {
    stubFetch({
      '/api/tags': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    await expect(isOllamaModelPulled(curatedTag(0))).resolves.toBe(false);
  });
});

describe('pullOllamaModel', () => {
  it('forwards NDJSON progress and terminates on success', async () => {
    stubFetch({
      '/api/pull': PULL_ROUTE([
        { status: 'pulling manifest' },
        { status: 'downloading sha256:abc', digest: 'sha256:abc', total: 1000, completed: 400 },
        { status: 'success' },
      ]),
    });
    const events: OllamaPullProgressEvent[] = [];
    for await (const event of pullOllamaModel(curatedTag(2), new AbortController().signal)) {
      events.push(event);
    }
    expect(events).toEqual([
      { modelTag: curatedTag(2), status: 'pulling manifest' },
      {
        modelTag: curatedTag(2),
        status: 'downloading sha256:abc',
        completed: 400,
        total: 1000,
      },
      { modelTag: curatedTag(2), status: 'success' },
    ]);
  });

  it('terminates with an error event on an Ollama error frame', async () => {
    stubFetch({
      '/api/pull': PULL_ROUTE([
        { status: 'pulling manifest' },
        { error: 'pull model manifest: file does not exist' },
      ]),
    });
    const events: OllamaPullProgressEvent[] = [];
    for await (const event of pullOllamaModel(curatedTag(1), new AbortController().signal)) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      modelTag: curatedTag(1),
      status: 'error',
      error: 'pull model manifest: file does not exist',
    });
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe('ollama routes', () => {
  it('GET /api/providers lists ollama as a keyless, connected provider', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(response.statusCode).toBe(200);
    const ollama = (response.json() as Array<{ id: string }>).find((p) => p.id === 'ollama');
    expect(ollama).toMatchObject({
      label: 'Ollama',
      hasKey: true,
      keyHint: null,
      status: 'connected',
    });
  });

  it('GET /api/providers/ollama/status reports the live daemon state', async () => {
    stubFetch({ '/api/version': VERSION_ROUTE });
    const online = await app.inject({ method: 'GET', url: '/api/providers/ollama/status' });
    expect(online.statusCode).toBe(200);
    expect(online.json()).toEqual({ running: true, version: '0.12.6' });

    stubFetch({
      '/api/version': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const offline = await app.inject({ method: 'GET', url: '/api/providers/ollama/status' });
    expect(offline.json()).toEqual({ running: false, version: null });
  });

  it('GET /api/providers/ollama/models degrades gracefully while offline', async () => {
    stubFetch({
      '/api/version': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/providers/ollama/models' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { running: boolean; models: Array<{ downloaded: boolean }> };
    expect(body.running).toBe(false);
    expect(body.models).toHaveLength(3);
    expect(body.models.every((model) => !model.downloaded)).toBe(true);
  });

  it('GET /api/providers/ollama/models cross-references pulled models and sizes', async () => {
    stubFetch({
      '/api/version': VERSION_ROUTE,
      '/api/tags': TAGS_ROUTE([
        {
          name: 'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M:latest',
          size: 14_111_222_333,
        },
        { name: 'hf.co/BeaverAI/Rocinante-XL-16B-v1b-GGUF:Q4_K_M', size: 9_999_999_999 },
      ]),
    });
    const response = await app.inject({ method: 'GET', url: '/api/providers/ollama/models' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      running: boolean;
      models: Array<{ label: string; downloaded: boolean; sizeBytes: number | null }>;
    };
    expect(body.running).toBe(true);
    const byLabel = new Map(body.models.map((model) => [model.label, model]));
    expect(byLabel.get('Mistral Small 3.2 24B Abliterated (Q4_K_M)')).toMatchObject({
      downloaded: true,
      sizeBytes: 14_111_222_333,
    });
    expect(byLabel.get('Cydonia 24B v4.3-Heresy (Q4_K_M)')).toMatchObject({
      downloaded: false,
      sizeBytes: null,
    });
    expect(byLabel.get('Rocinante XL 16B v1b (Q4_K_M)')).toMatchObject({
      downloaded: true,
      sizeBytes: 9_999_999_999,
    });
  });

  it('POST /api/providers/ollama/test persists the connection probe', async () => {
    stubFetch({
      '/api/version': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const offline = await app.inject({ method: 'POST', url: '/api/providers/ollama/test' });
    expect(offline.statusCode).toBe(200);
    expect(offline.json()).toMatchObject({ status: 'error', code: 'network_error' });

    stubFetch({ '/api/version': VERSION_ROUTE });
    const online = await app.inject({ method: 'POST', url: '/api/providers/ollama/test' });
    expect(online.json()).toMatchObject({ status: 'connected' });

    const providers = await app.inject({ method: 'GET', url: '/api/providers' });
    const ollama = (providers.json() as Array<{ id: string; status: string }>).find(
      (p) => p.id === 'ollama',
    );
    expect(ollama?.status).toBe('connected');
  });

  it('POST /api/providers/ollama/pull rejects non-curated tags', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/ollama/pull',
      payload: { modelTag: 'some/rogue-model' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_model_tag' });
  });

  it('POST /api/providers/ollama/pull refuses to stream while the daemon is offline', async () => {
    stubFetch({
      '/api/version': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/ollama/pull',
      payload: { modelTag: curatedTag(1) },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'ollama_offline' });
  });

  it('POST /api/providers/ollama/pull streams progress frames over SSE', async () => {
    stubFetch({
      '/api/version': VERSION_ROUTE,
      '/api/pull': PULL_ROUTE([
        { status: 'pulling manifest' },
        { status: 'downloading', total: 1000, completed: 250 },
        { status: 'success' },
      ]),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/ollama/pull',
      payload: { modelTag: curatedTag(1) },
    });
    expect(response.statusCode).toBe(200);
    const frames = response.payload
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({ status: 'pulling manifest' });
    expect(frames[1]).toMatchObject({ status: 'downloading', completed: 250, total: 1000 });
    expect(frames[2]).toMatchObject({ status: 'success' });
  });
});

// ---------------------------------------------------------------------------
// Generation pre-flight (offline / not-downloaded / happy path with num_ctx)
// ---------------------------------------------------------------------------

describe('generation preflight for ollama', () => {
  it('fails with 503 ollama_offline when the daemon is unreachable', async () => {
    stubFetch({
      '/api/version': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const response = await app.inject({ method: 'POST', url: `/api/chats/${chatId}/generate` });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'ollama_offline',
      message: 'Ollama is not running. Please install or start Ollama on your computer.',
    });
  });

  it('fails with 409 model_not_downloaded when the model is not pulled', async () => {
    stubFetch({ '/api/version': VERSION_ROUTE, '/api/tags': TAGS_ROUTE([]) });
    const response = await app.inject({ method: 'POST', url: `/api/chats/${chatId}/generate` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'model_not_downloaded' });
  });

  it('streams a reply with num_ctx when the model is pulled', async () => {
    stubFetch({
      '/api/version': VERSION_ROUTE,
      '/api/tags': TAGS_ROUTE([
        {
          name: 'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M:latest',
          size: 1,
        },
      ]),
      '/api/chat': CHAT_NATIVE_ROUTE(),
    });
    const response = await app.inject({ method: 'POST', url: `/api/chats/${chatId}/generate` });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('"type":"meta"');
    expect(response.payload).toContain('"type":"delta"');
    expect(response.payload).toContain('"finishReason":"stop"');

    // num_ctx must ride the native chat request body with the effective budget.
    const chatCall = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(([url]) =>
      String(url).includes('/api/chat'),
    );
    expect(chatCall).toBeDefined();
    const body = JSON.parse(String(chatCall?.[1].body)) as {
      options?: { num_ctx?: number };
    };
    expect(body.options?.num_ctx).toBe(8192);
  });
});
