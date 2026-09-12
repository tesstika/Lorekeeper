import type {
  ChatRequest,
  ModelInfo,
  OllamaPullProgressEvent,
  StreamEvent,
  TokenUsage,
} from '@lorekeeper/shared';
import { fetchWithMapping, testConnectionCompat } from './openaiCompat';
import { type LlmProvider, ProviderError } from './types';

export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

/** The user-friendly offline message (feature spec §2) shared by banner + errors. */
export const OLLAMA_OFFLINE_MESSAGE =
  'Ollama is not running. Please install or start Ollama on your computer.';

export interface OllamaCuratedEntry {
  tag: string;
  label: string;
  huggingFaceUrl: string;
}

/**
 * Curated roleplay whitelist (feature spec §2): the ONLY models Lorekeeper
 * offers for Ollama. Everything else (catalog, pull, generation preflight)
 * is constrained to these tags.
 */
export const OLLAMA_CURATED_MODELS: OllamaCuratedEntry[] = [
  {
    tag: 'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M',
    label: 'Mistral Small 3.2 24B Abliterated (Q4_K_M)',
    huggingFaceUrl:
      'https://huggingface.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M',
  },
  {
    tag: 'hf.co/jwhisenhunt/Cydonia-24B-v4.3-absolute-heresy-Q4_K_M-GGUF',
    label: 'Cydonia 24B v4.3-Heresy (Q4_K_M)',
    huggingFaceUrl:
      'https://huggingface.co/jwhisenhunt/Cydonia-24B-v4.3-absolute-heresy-Q4_K_M-GGUF',
  },
  {
    tag: 'hf.co/BeaverAI/Rocinante-XL-16B-v1b-GGUF:Q4_K_M',
    label: 'Rocinante XL 16B v1b (Q4_K_M)',
    huggingFaceUrl: 'https://huggingface.co/BeaverAI/Rocinante-XL-16B-v1b-GGUF',
  },
];

/**
 * Tag equality with Ollama's `:latest` normalization: a pull without an
 * explicit tag is stored as `<name>:latest`, so a curated tag with no suffix
 * matches its `:latest` variant in /api/tags (and vice versa).
 */
export function ollamaTagsMatch(stored: string, wanted: string): boolean {
  if (stored === wanted) return true;
  const storedHasExplicitTag = stored.includes(':');
  const wantedHasExplicitTag = wanted.includes(':');
  if (storedHasExplicitTag !== wantedHasExplicitTag) {
    return storedHasExplicitTag ? stored.slice(0, stored.lastIndexOf(':')) === wanted : false;
  }
  return false;
}

/** True when the installed Ollama has a model matching `tag` pulled. */
export async function isOllamaModelPulled(tag: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const tags = await fetchOllamaTags(signal);
    return tags.some((entry) => ollamaTagsMatch(entry.name, tag));
  } catch {
    return false;
  }
}

/**
 * Resolves a requested tag against the daemon's installed tags so generation
 * always names the exact installed model. A manual pull can store the curated
 * tag under an explicit quantifier suffix (e.g. `…:Q4_K_M`), which Ollama
 * would never resolve from the bare tag (`:latest` miss → "model not found").
 */
export async function resolveInstalledOllamaTag(
  requestedTag: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const tags = await fetchOllamaTags(signal);
    const installed = tags.find((entry) => ollamaTagsMatch(entry.name, requestedTag));
    return installed?.name ?? requestedTag;
  } catch {
    return requestedTag;
  }
}

export interface OllamaStatus {
  running: boolean;
  version: string | null;
}

/** Pings `GET /api/version`; daemon-unreachable degrades to `{ running: false }`. */
export async function fetchOllamaStatus(signal?: AbortSignal): Promise<OllamaStatus> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
      method: 'GET',
      signal: signal ?? AbortSignal.timeout(2_500),
    });
    if (!response.ok) return { running: false, version: null };
    const body = (await response.json()) as { version?: unknown } | null;
    return {
      running: true,
      version: typeof body?.version === 'string' ? body.version : null,
    };
  } catch {
    return { running: false, version: null };
  }
}

export interface OllamaTagEntry {
  name: string;
  size: number;
}

/** Queries `GET /api/tags`; failures surface as ProviderError (network_error). */
export async function fetchOllamaTags(signal?: AbortSignal): Promise<OllamaTagEntry[]> {
  const response = await fetchWithMapping(`${OLLAMA_BASE_URL}/api/tags`, {
    method: 'GET',
    signal: signal ?? AbortSignal.timeout(5_000),
  });
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ProviderError('malformed_response', 'Ollama returned non-JSON /api/tags payload');
  }
  const models = (json as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) {
    throw new ProviderError('malformed_response', 'Ollama /api/tags payload has no `models` array');
  }
  return models
    .filter(
      (raw): raw is { name?: unknown; size?: unknown } => raw !== null && typeof raw === 'object',
    )
    .map((raw) => ({
      name: typeof raw.name === 'string' ? raw.name : '',
      size: typeof raw.size === 'number' ? raw.size : 0,
    }))
    .filter((entry) => entry.name.length > 0);
}

/**
 * Streams Ollama's `POST /api/pull` NDJSON progress as curated-shaped events.
 * Terminates on `status: 'success'`, an `error` frame, an upstream failure or
 * an abort; the caller forwards the events to the browser via SSE.
 */
export async function* pullOllamaModel(
  modelTag: string,
  signal: AbortSignal,
): AsyncGenerator<OllamaPullProgressEvent, void, undefined> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelTag, stream: true }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    throw new ProviderError('network_error', OLLAMA_OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    const message = `Ollama pull failed with HTTP ${response.status}`;
    yield { modelTag, status: 'error', error: message };
    return;
  }
  if (!response.body) {
    yield { modelTag, status: 'error', error: 'Ollama returned an empty pull stream' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (line.length === 0) continue;
        let frame: { status?: unknown; completed?: unknown; total?: unknown; error?: unknown };
        try {
          frame = JSON.parse(line) as typeof frame;
        } catch {
          continue; // skip unparseable progress lines rather than kill the pull
        }
        if (typeof frame.error === 'string' && frame.error) {
          yield { modelTag, status: 'error', error: frame.error };
          return;
        }
        const status = typeof frame.status === 'string' ? frame.status : '';
        const event: OllamaPullProgressEvent = {
          modelTag,
          status,
          ...(typeof frame.completed === 'number' ? { completed: frame.completed } : {}),
          ...(typeof frame.total === 'number' ? { total: frame.total } : {}),
        };
        yield event;
        if (status === 'success') return;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    yield {
      modelTag,
      status: 'error',
      error: error instanceof Error ? error.message : 'Ollama pull stream failed',
    };
    return;
  }
  yield { modelTag, status: 'error', error: 'The Ollama pull stream ended before completing' };
}

/** The curated whitelist as provider-catalog ModelInfo entries (static, no network). */
export function curatedOllamaModelInfos(): ModelInfo[] {
  return OLLAMA_CURATED_MODELS.map((entry) => ({
    id: entry.tag,
    name: entry.label,
    contextLength: null,
    inputModalities: [],
  }));
}

// ---------------------------------------------------------------------------
// Native /api/chat generation. Ollama 0.34's OpenAI-compatible /v1 endpoint
// silently IGNORES `options` (verified live 2026-09-12: a request with
// num_ctx 8192 left the model loaded at its 4096 default), so num_ctx must
// ride the native endpoint, which honors it. Native chat streams NDJSON,
// not SSE.
// ---------------------------------------------------------------------------

interface OllamaChatFrame {
  message?: { content?: unknown } | null;
  done?: unknown;
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  error?: unknown;
}

/** OpenAI-style content parts → native messages (base64 images array). */
export function toNativeMessages(
  request: ChatRequest,
): Array<{ role: string; content: string; images?: string[] }> {
  return request.messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    const texts: string[] = [];
    const images: string[] = [];
    for (const part of message.content) {
      if (part.type === 'text') {
        texts.push(part.text);
      } else {
        const url = part.imageUrl.url;
        const base64 = url.startsWith('data:') ? (url.split(',')[1] ?? '') : url;
        if (base64.length > 0) images.push(base64);
      }
    }
    return {
      role: message.role,
      content: texts.join('\n\n'),
      ...(images.length > 0 ? { images } : {}),
    };
  });
}

export function toNativeOptions(request: ChatRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {
    temperature: request.temperature,
    top_p: request.topP,
    num_predict: request.maxTokens,
  };
  if (typeof request.numCtx === 'number' && request.numCtx > 0) options.num_ctx = request.numCtx;
  if (request.topK != null) options.top_k = request.topK;
  if (request.repetitionPenalty != null) options.repeat_penalty = request.repetitionPenalty;
  if (request.stopSequences.length > 0) options.stop = request.stopSequences;
  return options;
}

function mapFinishReason(doneReason: unknown): 'stop' | 'length' {
  return doneReason === 'length' ? 'length' : 'stop';
}

export async function* streamChatOllama(
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
  const model = await resolveInstalledOllamaTag(request.model, signal);
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: toNativeMessages(request),
        stream: true,
        options: toNativeOptions(request),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    throw new ProviderError('network_error', OLLAMA_OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    let message = `Ollama chat failed with HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown } | null;
      if (typeof body?.error === 'string' && body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new ProviderError('provider_error', message, { statusCode: response.status });
  }
  if (!response.body) {
    throw new ProviderError('malformed_response', 'Ollama returned an empty chat stream body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let usage: TokenUsage | undefined;
  let finishReason: 'stop' | 'length' | 'aborted' | null = null;
  let aborted = false;
  let sawDone = false;

  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (line.length === 0) continue;
        let frame: OllamaChatFrame;
        try {
          frame = JSON.parse(line) as OllamaChatFrame;
        } catch {
          throw new ProviderError(
            'malformed_response',
            `Unparseable Ollama chat frame: ${line.slice(0, 120)}`,
          );
        }
        if (typeof frame.error === 'string' && frame.error) {
          yield { type: 'error', code: 'upstream_error', message: frame.error };
          return;
        }
        const text = frame.message?.content;
        if (typeof text === 'string' && text.length > 0) {
          yield { type: 'delta', text };
        }
        if (frame.done === true && frame.done_reason !== 'load') {
          sawDone = true;
          finishReason = mapFinishReason(frame.done_reason);
          const promptTokens =
            typeof frame.prompt_eval_count === 'number' ? frame.prompt_eval_count : 0;
          const completionTokens = typeof frame.eval_count === 'number' ? frame.eval_count : 0;
          usage = { promptTokens, completionTokens };
          break;
        }
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
  // D-T1 policy: a FIN without a terminal frame is a silent truncation.
  if (sawDone) {
    yield { type: 'done', finishReason: finishReason ?? 'stop', ...(usage ? { usage } : {}) };
    return;
  }
  throw new ProviderError(
    'connection_closed',
    'Ollama closed the stream before the reply completed — partial text was kept.',
  );
}

export const ollamaProvider: LlmProvider = {
  id: 'ollama',
  label: 'Ollama',
  baseUrl: `${OLLAMA_BASE_URL}/v1`,

  listModels() {
    // The catalog IS the curated whitelist — no daemon round-trip needed.
    return Promise.resolve(curatedOllamaModelInfos());
  },

  testConnection() {
    return testConnectionCompat(`${OLLAMA_BASE_URL}/api/version`, {});
  },

  streamChat(request, _apiKey, signal) {
    // Native /api/chat (see the block comment above): honors options.num_ctx
    // and streams NDJSON deltas.
    return streamChatOllama(request, signal);
  },
};
