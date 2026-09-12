import type { ProviderId } from '@lorekeeper/shared';
import { mockProvider } from './mock';
import { ollamaProvider } from './ollama';
import { openRouterProvider } from './openrouter';
import type { LlmProvider } from './types';
import { unoRouterProvider } from './unorouter';

export const providerRegistry: Record<ProviderId, LlmProvider> = {
  openrouter: openRouterProvider,
  unorouter: unoRouterProvider,
  ollama: ollamaProvider,
};

const USE_MOCK = process.env.LOREKEEPER_MOCK_PROVIDER === '1';

/** Resolves a provider; LOREKEEPER_MOCK_PROVIDER=1 swaps both for the mock (dev). */
export function getProvider(id: ProviderId): LlmProvider {
  if (USE_MOCK) return mockProvider;
  return providerRegistry[id];
}

/** Test seam: swap a provider implementation for a stub and restore it after. */
export function setProviderForTesting(id: ProviderId, provider: LlmProvider): void {
  providerRegistry[id] = provider;
}

export {
  OLLAMA_BASE_URL,
  OLLAMA_CURATED_MODELS,
  OLLAMA_OFFLINE_MESSAGE,
  ollamaProvider,
} from './ollama';
export { type LlmProvider, ProviderError } from './types';
export { openRouterProvider, unoRouterProvider };
