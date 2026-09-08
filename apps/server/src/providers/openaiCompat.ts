import type { ChatMessageInput, ChatRequest, StreamEvent, TokenUsage } from '@lorekeeper/shared';
import { ProviderError } from './types';

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

export function authHeaders(
  apiKey: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, ...extra };
}

// ---------------------------------------------------------------------------
// Request building (§4.2): images as content parts, text first; passthrough
// params (top_k, repetition_penalty) only when non-null.
// ---------------------------------------------------------------------------

function toWireMessage(message: ChatMessageInput): unknown {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image_url', image_url: { url: part.imageUrl.url } },
    ),
  };
}

export function toWireBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(toWireMessage),
    temperature: request.temperature,
    top_p: request.topP,
    max_tokens: request.maxTokens,
    frequency_penalty: request.frequencyPenalty,
    presence_penalty: request.presencePenalty,
    stream,
  };
  if (request.stopSequences.length > 0) body.stop = request.stopSequences;
  if (request.topK != null) body.top_k = request.topK;
  if (request.repetitionPenalty != null) body.repetition_penalty = request.repetitionPenalty;
  if (stream && request.includeUsage) body.usage = { include: true };
  return body;
}

// ---------------------------------------------------------------------------
// Error mapping (401 → invalid_key, 402 → insufficient_credits, 429 + Retry-After,
// 5xx → upstream_error, network faults → network_error)
// ---------------------------------------------------------------------------

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

export function mapHttpError(
  status: number,
  message: string,
  retryAfterMs?: number,
): ProviderError {
  const opts: { statusCode: number; retryAfterMs?: number } = { statusCode: status };
  if (retryAfterMs !== undefined) opts.retryAfterMs = retryAfterMs;
  if (status === 401) return new ProviderError('invalid_key', message, opts);
  if (status === 402) return new ProviderError('insufficient_credits', message, opts);
  if (status === 429) return new ProviderError('rate_limited', message, opts);
  if (status >= 500) return new ProviderError('upstream_error', message, opts);
  return new ProviderError('provider_error', message, opts);
}

async function responseError(response: Response): Promise<ProviderError> {
  let message = `Provider returned HTTP ${response.status}`;
  try {
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    const providerMessage =
      (parsed as { error?: { message?: unknown } } | null)?.error?.message ??
      (parsed as { message?: unknown } | null)?.message;
    if (typeof providerMessage === 'string' && providerMessage.length > 0) {
      message = providerMessage;
    }
  } catch {
    // keep the generic message
  }
  return mapHttpError(
    response.status,
    message,
    parseRetryAfter(response.headers.get('retry-after')),
  );
}

export async function fetchWithMapping(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ProviderError('network_error', `Provider request timed out: ${url}`);
    }
    throw new ProviderError(
      'network_error',
      `Could not reach provider: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw await responseError(response);
  return response;
}

// ---------------------------------------------------------------------------
// Catalog fetch (GET /models → parsed JSON of any OpenAI-ish shape)
// ---------------------------------------------------------------------------

export async function fetchModelsJson(
  modelsUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchWithMapping(modelsUrl, {
    method: 'GET',
    headers,
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ProviderError('malformed_response', 'Provider returned non-JSON model catalog');
  }
}

// ---------------------------------------------------------------------------
// SSE engine (D1): line-buffered `data:` frames, `[DONE]`, mid-stream error
// frames, terminal usage chunk (accounting-only — OpenRouter repeats
// finish_reason on it).
// ---------------------------------------------------------------------------

export async function* parseSsePayloads(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) break;
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload.length > 0) yield payload;
    }
  }
  // Flush a final line that lacks a trailing newline.
  const tail = buffer.replace(/\r$/, '');
  if (tail.startsWith('data:')) {
    const payload = tail.slice(5).trim();
    if (payload.length > 0) yield payload;
  }
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  } | null;
  error?: { message?: unknown; code?: unknown } | null;
}

export async function* streamChatCompat(
  chatCompletionsUrl: string,
  headers: Record<string, string>,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(toWireBody(request, true)),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return;
    }
    throw new ProviderError(
      'network_error',
      `Could not reach provider: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw await responseError(response);
  if (!response.body) {
    throw new ProviderError('malformed_response', 'Provider returned an empty stream body');
  }

  let usage: TokenUsage | undefined;
  let finishReason: 'stop' | 'length' | 'aborted' | 'tool_calls' | null = null;
  let aborted = false;

  try {
    for await (const payload of parseSsePayloads(response.body)) {
      if (payload === '[DONE]') break;
      let chunk: ChatCompletionChunk;
      try {
        chunk = JSON.parse(payload) as ChatCompletionChunk;
      } catch {
        throw new ProviderError(
          'malformed_response',
          `Unparseable SSE payload: ${payload.slice(0, 120)}`,
        );
      }
      if (chunk.error) {
        const message =
          typeof chunk.error.message === 'string' && chunk.error.message
            ? chunk.error.message
            : 'Provider reported a mid-stream error';
        // Preserve a numeric provider code (e.g. 429) for the error bubble
        // (M1 D-P1: mid-stream frames must not flatten status away).
        const statusCode = typeof chunk.error.code === 'number' ? chunk.error.code : undefined;
        yield {
          type: 'error',
          code: 'upstream_error',
          message,
          ...(statusCode !== undefined ? { statusCode } : {}),
        };
        return;
      }
      const choice = chunk.choices?.[0];
      const text = choice?.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        yield { type: 'delta', text };
      }
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason !== 'stop') {
        finishReason = choice.finish_reason as 'stop' | 'length' | 'aborted' | 'tool_calls';
      } else if (choice?.finish_reason === 'stop') {
        finishReason = 'stop';
      }
      // Terminal usage chunk (OpenRouter repeats finish_reason here) — accounting only.
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          ...(typeof chunk.usage.cost === 'number' ? { costUsd: chunk.usage.cost } : {}),
        };
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      aborted = true;
    } else {
      throw error;
    }
  }

  if (aborted) {
    yield { type: 'done', finishReason: 'aborted', ...(usage ? { usage } : {}) };
    return;
  }
  yield { type: 'done', finishReason: finishReason ?? 'stop', ...(usage ? { usage } : {}) };
}

// ---------------------------------------------------------------------------
// Connection test: ping GET /models and measure latency.
// ---------------------------------------------------------------------------

export async function testConnectionCompat(
  modelsUrl: string,
  headers: Record<string, string>,
): Promise<{ latencyMs: number }> {
  const startedAt = performance.now();
  const response = await fetchWithMapping(modelsUrl, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  await response.arrayBuffer();
  return { latencyMs };
}

// ---------------------------------------------------------------------------
// Shared catalog mapping helpers
// ---------------------------------------------------------------------------

export function toOptionalPrice(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const price = Number(value);
  return Number.isFinite(price) ? price : undefined;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
