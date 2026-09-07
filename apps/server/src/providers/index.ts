import type { ProviderId } from '@lorekeeper/shared';
import { openRouterProvider } from './openrouter';
import type { LlmProvider } from './types';
import { unoRouterProvider } from './unorouter';

export const providerRegistry: Record<ProviderId, LlmProvider> = {
  openrouter: openRouterProvider,
  unorouter: unoRouterProvider,
};

export function getProvider(id: ProviderId): LlmProvider {
  return providerRegistry[id];
}

export { type LlmProvider, ProviderError } from './types';
export { openRouterProvider, unoRouterProvider };
