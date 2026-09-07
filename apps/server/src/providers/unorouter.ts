import type { ModelInfo } from '@lorekeeper/shared';
import {
  authHeaders,
  fetchModelsJson,
  streamChatCompat,
  testConnectionCompat,
  toOptionalPrice,
} from './openaiCompat';
import { type LlmProvider, ProviderError } from './types';

const BASE_URL = 'https://api.unorouter.com/v1';

interface UnoRouterModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  supported_endpoint_types?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
}

/**
 * A1 (live-verified 2026-09-07): UnoRouter returns OpenAI-minimal metadata —
 * `context_length` only on some models and **no modality metadata at all**.
 * Catalog parsing therefore degrades gracefully: missing fields → null/[] and
 * the UI treats an empty `inputModalities` as "unknown → allow with warning".
 */
function toModelInfo(raw: UnoRouterModel): ModelInfo {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : '';
  const promptPrice = toOptionalPrice(raw.pricing?.prompt);
  const completionPrice = toOptionalPrice(raw.pricing?.completion);
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    contextLength: typeof raw.context_length === 'number' ? raw.context_length : null,
    inputModalities: [],
    ...(promptPrice !== undefined ? { promptPrice } : {}),
    ...(completionPrice !== undefined ? { completionPrice } : {}),
  };
}

export const unoRouterProvider: LlmProvider = {
  id: 'unorouter',
  label: 'UnoRouter',
  baseUrl: BASE_URL,

  async listModels(apiKey, signal) {
    const json = await fetchModelsJson(`${BASE_URL}/models`, authHeaders(apiKey), signal);
    const data = (json as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) {
      throw new ProviderError('malformed_response', 'UnoRouter model catalog has no `data` array');
    }
    return data
      .filter((raw): raw is UnoRouterModel => raw !== null && typeof raw === 'object')
      .map(toModelInfo)
      .filter((model) => model.id.length > 0);
  },

  testConnection(apiKey) {
    return testConnectionCompat(`${BASE_URL}/models`, authHeaders(apiKey));
  },

  streamChat(request, apiKey, signal) {
    return streamChatCompat(`${BASE_URL}/chat/completions`, authHeaders(apiKey), request, signal);
  },
};
