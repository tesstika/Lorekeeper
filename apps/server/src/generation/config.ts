import type { ModelInfo, ProviderId } from '@lorekeeper/shared';
import type { LorekeeperDb } from '../db/client';
import type { ChatRow } from '../services/chatsRepo';
import { getGlobalDefaults, getModelCache } from '../services/settingsRepo';

// ---------------------------------------------------------------------------
// Generation configuration (plan §4.2, §5): single-flight state + effective
// override resolution. Kept apart from the session engine so the prompt
// preview route can reuse the exact same config logic (M4).
// ---------------------------------------------------------------------------

/** One active generation per chat (D1 control plane; 409 otherwise). */
export const activeGenerations = new Set<string>();

export function isGenerating(chatId: string): boolean {
  return activeGenerations.has(chatId);
}

/**
 * Configuration failures that can be resolved before any SSE stream opens →
 * clean HTTP/JSON errors instead of error events.
 */
export class SessionConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SessionConfigError';
    this.code = code;
  }
}

export interface ResolvedGenerationConfig {
  providerId: ProviderId;
  modelId: string;
  presetId: string | null;
  personaId: string | null;
  modelInfo: ModelInfo | null;
  hasKey: boolean;
}

/**
 * Effective overrides (plan §4.2): chat.* ?? globalDefaults.* for provider,
 * model, preset and persona. Zero defaults → explicit `no_model_configured`
 * (M1 audit D-S1). `chats.personaNone` marks an explicit "play without a
 * persona" override — it suppresses both the chat persona and the global
 * default (M4-audit §4.3 fix; the '' sentinel violated the personas FK).
 */
export function resolveGenerationConfig(db: LorekeeperDb, chat: ChatRow): ResolvedGenerationConfig {
  const defaults = getGlobalDefaults(db);
  const providerId = chat.providerId ?? defaults.providerId;
  const modelId = chat.modelId ?? defaults.modelId;
  if (!providerId) {
    throw new SessionConfigError(
      'no_model_configured',
      'No provider configured — set a provider in Settings → Intelligence Engine or as a chat override.',
    );
  }
  if (!modelId) {
    throw new SessionConfigError(
      'no_model_configured',
      'No model configured — pick a model in Settings → Intelligence Engine or as a chat override.',
    );
  }
  const cache = getModelCache(db, providerId);
  const modelInfo = cache?.models.find((model) => model.id === modelId) ?? null;
  const presetId = chat.presetId ?? defaults.presetId;
  const personaId = chat.personaNone ? null : (chat.personaId ?? defaults.personaId);
  return { providerId, modelId, presetId, personaId, modelInfo, hasKey: false };
}

/** Effective context budget (plan §4.3): chat override ?? global default. */
export function resolveContextBudgetTokens(db: LorekeeperDb, chat: ChatRow): number {
  return chat.contextBudgetTokens ?? getGlobalDefaults(db).contextBudgetTokens;
}
