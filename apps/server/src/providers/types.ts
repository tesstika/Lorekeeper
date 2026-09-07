import type { ChatRequest, ModelInfo, ProviderId, StreamEvent } from '@lorekeeper/shared';

/**
 * Plan §5 — provider abstraction. Both providers speak the OpenAI wire format;
 * `openaiCompat.ts` carries the shared engine, these files add per-provider
 * catalog parsing and headers.
 */
export interface LlmProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly baseUrl: string;
  listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]>;
  testConnection(apiKey: string): Promise<{ latencyMs: number }>;
  streamChat(req: ChatRequest, apiKey: string, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

/** Normalized provider failure with a stable `code` for the error contract (§6.8). */
export class ProviderError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(
    code: string,
    message: string,
    options: { statusCode?: number | undefined; retryAfterMs?: number | undefined } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}
