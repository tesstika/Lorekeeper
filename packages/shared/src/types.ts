import type { ProviderId } from './enums';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
}

export interface ChatError {
  code: string;
  message: string;
  providerId?: ProviderId;
  modelId?: string;
  statusCode?: number;
  retryAfterMs?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number | null;
  inputModalities: string[];
  promptPrice?: number | undefined;
  completionPrice?: number | undefined;
}

// ---------------------------------------------------------------------------
// Provider wire types (§5 provider abstraction — shared by server + tests)
// ---------------------------------------------------------------------------

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string } };

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessageInput[];
  temperature: number;
  topP: number;
  /** Included in the request only when non-null (provider passthrough). */
  topK?: number | null;
  maxTokens: number;
  frequencyPenalty: number;
  presencePenalty: number;
  /** Included in the request only when non-null (provider passthrough). */
  repetitionPenalty?: number | null;
  stopSequences: string[];
  /** OpenRouter-only: ask the terminal chunk for token accounting. */
  includeUsage?: boolean;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      finishReason: 'stop' | 'length' | 'aborted' | 'tool_calls' | null;
      usage?: TokenUsage;
    }
  | { type: 'error'; code: string; message: string; retryAfterMs?: number };
