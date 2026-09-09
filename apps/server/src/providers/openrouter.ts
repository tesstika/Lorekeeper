import type { ModelInfo } from '@lorekeeper/shared';
import {
  authHeaders,
  fetchModelsJson,
  streamChatCompat,
  testConnectionCompat,
  toOptionalPrice,
  toStringArray,
} from './openaiCompat';
import { type LlmProvider, ProviderError } from './types';

const BASE_URL = 'https://openrouter.ai/api/v1';

/** Optional attribution header (plan §2.5) — set LOREKEEPER_HTTP_REFERER to opt in. */
function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-Title': 'Lorekeeper' };
  const referer = process.env.LOREKEEPER_HTTP_REFERER;
  if (referer) headers['HTTP-Referer'] = referer;
  return headers;
}

interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown } | null;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
}

function toModelInfo(raw: OpenRouterModel): ModelInfo {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : '';
  const promptPrice = toOptionalPrice(raw.pricing?.prompt);
  const completionPrice = toOptionalPrice(raw.pricing?.completion);
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    contextLength: typeof raw.context_length === 'number' ? raw.context_length : null,
    inputModalities: toStringArray(raw.architecture?.input_modalities),
    ...(promptPrice !== undefined ? { promptPrice } : {}),
    ...(completionPrice !== undefined ? { completionPrice } : {}),
  };
}

export const openRouterProvider: LlmProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: BASE_URL,

  async listModels(apiKey, signal) {
    const json = await fetchModelsJson(
      `${BASE_URL}/models`,
      authHeaders(apiKey, attributionHeaders()),
      signal,
    );
    const data = (json as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) {
      throw new ProviderError('malformed_response', 'OpenRouter model catalog has no `data` array');
    }
    return data
      .filter((raw): raw is OpenRouterModel => raw !== null && typeof raw === 'object')
      .map(toModelInfo)
      .filter((model) => model.id.length > 0);
  },

  testConnection(apiKey) {
    // D-T10 (M4): authenticated probe. The public /models endpoint answers 200
    // for ANY key, so the "Connected" badge could lie about expired/invalid
    // keys. GET /auth/key validates the key itself (401 → invalid_key with the
    // status code preserved) and returns the account's key metadata on success.
    return testConnectionCompat(`${BASE_URL}/auth/key`, authHeaders(apiKey, attributionHeaders()));
  },

  streamChat(request, apiKey, signal) {
    return streamChatCompat(
      `${BASE_URL}/chat/completions`,
      authHeaders(apiKey, attributionHeaders()),
      request,
      signal,
    );
  },
};
