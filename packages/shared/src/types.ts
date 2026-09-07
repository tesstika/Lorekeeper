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
  promptPrice?: number;
  completionPrice?: number;
}
