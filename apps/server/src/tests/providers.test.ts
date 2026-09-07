import type { ChatRequest } from '@lorekeeper/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSsePayloads, streamChatCompat, toWireBody } from '../providers/openaiCompat';
import { openRouterProvider } from '../providers/openrouter';
import { ProviderError } from '../providers/types';
import { unoRouterProvider } from '../providers/unorouter';

const baseRequest: ChatRequest = {
  model: 'test/model',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.85,
  topP: 0.92,
  topK: 40,
  maxTokens: 512,
  frequencyPenalty: 0.1,
  presencePenalty: 0.2,
  repetitionPenalty: 1.1,
  stopSequences: ['User:'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sseResponse(text: string, chunkSize = 64): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('openaiCompat request builder', () => {
  it('maps camelCase params to the OpenAI wire format', () => {
    const body = toWireBody(baseRequest, true) as Record<string, unknown>;
    expect(body.model).toBe('test/model');
    expect(body.top_p).toBe(0.92);
    expect(body.max_tokens).toBe(512);
    expect(body.stop).toEqual(['User:']);
    expect(body.top_k).toBe(40);
    expect(body.repetition_penalty).toBe(1.1);
    expect(body.stream).toBe(true);
  });

  it('omits passthrough params and stop when unset', () => {
    const body = toWireBody(
      {
        ...baseRequest,
        topK: null,
        repetitionPenalty: null,
        stopSequences: [],
        includeUsage: false,
      },
      true,
    ) as Record<string, unknown>;
    expect('top_k' in body).toBe(false);
    expect('repetition_penalty' in body).toBe(false);
    expect('stop' in body).toBe(false);
  });

  it('maps image content parts (text first, then images)', () => {
    const body = toWireBody(
      {
        ...baseRequest,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe' },
              { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAA' } },
            ],
          },
        ],
      },
      false,
    ) as { messages: Array<{ content: unknown }> };
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: 'Describe' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });
});

describe('OpenRouter provider', () => {
  it('parses context_length, input_modalities and pricing from the catalog', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | globalThis.Request, _init?: RequestInit) =>
      jsonResponse({
        data: [
          {
            id: 'anthropic/claude-3.5-sonnet',
            name: 'Claude 3.5 Sonnet',
            context_length: 200000,
            architecture: { input_modalities: ['text', 'image'] },
            pricing: { prompt: '0.000003', completion: '0.000012' },
          },
          {
            id: 'text-only/model',
            name: 'Text Only',
            architecture: {},
          },
        ],
        total_count: 2,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await openRouterProvider.listModels('sk-test');
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      contextLength: 200000,
      inputModalities: ['text', 'image'],
      promptPrice: 0.000003,
      completionPrice: 0.000012,
    });
    expect(models[1]?.contextLength).toBeNull();
    expect(models[1]?.inputModalities).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect((init.headers as Record<string, string>)['X-Title']).toBe('Lorekeeper');
  });

  it('maps 401/402/429/5xx to stable error codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Invalid key' } }, 401)),
    );
    await expect(openRouterProvider.testConnection('bad')).rejects.toMatchObject({
      code: 'invalid_key',
      statusCode: 401,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'No credits' } }, 402)),
    );
    await expect(openRouterProvider.testConnection('k')).rejects.toMatchObject({
      code: 'insufficient_credits',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { message: 'Slow down' } }, 429, { 'retry-after': '3' }),
      ),
    );
    await expect(openRouterProvider.testConnection('k')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 3000,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: {} }, 503)),
    );
    await expect(openRouterProvider.testConnection('k')).rejects.toMatchObject({
      code: 'upstream_error',
      statusCode: 503,
    });
  });

  it('measures latency on a successful test connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [] })),
    );
    const { latencyMs } = await openRouterProvider.testConnection('sk-test');
    expect(latencyMs).toBeGreaterThanOrEqual(1);
  });

  it('maps network failures to network_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(openRouterProvider.testConnection('sk-test')).rejects.toMatchObject({
      code: 'network_error',
    });
  });
});

describe('UnoRouter provider (A1 graceful fallbacks)', () => {
  it('tolerates missing metadata in the OpenAI-shaped catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'free/model-a',
              object: 'model',
              owned_by: 'uno',
              supported_endpoint_types: ['openai'],
            },
            { id: 'big/model-b', object: 'model', context_length: 131072 },
          ],
        }),
      ),
    );
    const models = await unoRouterProvider.listModels('sk-uno-test');
    expect(models).toEqual([
      { id: 'free/model-a', name: 'free/model-a', contextLength: null, inputModalities: [] },
      { id: 'big/model-b', name: 'big/model-b', contextLength: 131072, inputModalities: [] },
    ]);
  });
});

describe('SSE streaming engine', () => {
  it('parses data: frames across chunk boundaries and skips comments', async () => {
    const text =
      ': ping\ndata: {"a":1}\n\ndata: {"b":[1,2]}\n\ndata: [DONE]\n\ndata: {"never":"sent"}';
    const seen: string[] = [];
    const response = sseResponse(text, 7);
    for await (const payload of parseSsePayloads(response.body as ReadableStream<Uint8Array>)) {
      seen.push(payload);
      if (payload === '[DONE]') break;
    }
    expect(seen).toEqual(['{"a":1}', '{"b":[1,2]}', '[DONE]']);
  });

  it('surfaces mid-stream error frames', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse('data: {"error":{"message":"Model overloaded"}}\n\ndata: [DONE]\n\n'),
      ),
    );
    const controller = new AbortController();
    const events: unknown[] = [];
    for await (const event of streamChatCompat(
      'https://example.test/v1/chat/completions',
      {},
      baseRequest,
      controller.signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'error', code: 'upstream_error', message: 'Model overloaded' },
    ]);
  });

  it('yields deltas then a done event with usage accounting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          [
            'data: {"choices":[{"delta":{"content":"Hi"}}]}',
            '',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'),
        ),
      ),
    );
    const controller = new AbortController();
    const events: unknown[] = [];
    for await (const event of streamChatCompat(
      'https://example.test/v1/chat/completions',
      {},
      baseRequest,
      controller.signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'done', finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 1 } },
    ]);
  });

  it('reports client aborts as finishReason aborted (partial text kept)', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init?: { signal?: AbortSignal }) =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(streamController) {
                streamController.enqueue(
                  encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
                );
                init?.signal?.addEventListener('abort', () => {
                  try {
                    streamController.error(
                      new DOMException('The operation was aborted.', 'AbortError'),
                    );
                  } catch {
                    // stream already closed
                  }
                });
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const events: unknown[] = [];
    const collect = (async () => {
      for await (const event of streamChatCompat(
        'https://example.test/v1/chat/completions',
        {},
        baseRequest,
        controller.signal,
      )) {
        events.push(event);
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await collect;
    expect(events).toEqual([
      { type: 'delta', text: 'partial' },
      { type: 'done', finishReason: 'aborted' },
    ]);
  });

  it('emits nothing when aborted before the request starts', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
        if (init?.signal?.aborted)
          throw new DOMException('The operation was aborted.', 'AbortError');
        return sseResponse('data: [DONE]\n\n');
      }),
    );
    const events: unknown[] = [];
    for await (const event of streamChatCompat(
      'https://example.test/v1/chat/completions',
      {},
      baseRequest,
      controller.signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([]);
  });

  it('keeps ProviderError contracts intact', () => {
    const error = new ProviderError('rate_limited', 'Slow down', {
      statusCode: 429,
      retryAfterMs: 1200,
    });
    expect(error.code).toBe('rate_limited');
    expect(error.statusCode).toBe(429);
    expect(error.retryAfterMs).toBe(1200);
  });
});
