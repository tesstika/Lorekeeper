import type { ChatRequest, ModelInfo, StreamEvent } from '@lorekeeper/shared';
import type { LlmProvider } from './types';

const MOCK_TALE =
  '*The candles gutter as she leans closer, silver rings clicking against the crystal ball.* ' +
  '"You returned after midnight, Julian. The house remembers every promise made beneath its roof." ' +
  'A cold draft coils through the library, carrying the faint scent of rain and old parchment. ' +
  '*She extends her hand, palm up, waiting.* "Show me what you took from the seal."';

export const MOCK_MODEL: ModelInfo = {
  id: 'mock/lk-scribe',
  name: 'Mock Scribe (dev)',
  contextLength: 32_768,
  inputModalities: ['text', 'image'],
};

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dev-only provider (LOREKEEPER_MOCK_PROVIDER=1): streams a canned tale with
 * realistic pacing so the SSE engine, animations and abort path can be
 * exercised in the browser without provider keys. Never selected otherwise.
 */
export const mockProvider: LlmProvider = {
  id: 'openrouter',
  label: 'Mock Scribe (dev)',
  baseUrl: 'mock://local',
  async listModels(): Promise<ModelInfo[]> {
    return [MOCK_MODEL];
  },
  async testConnection(): Promise<{ latencyMs: number }> {
    return { latencyMs: 3 };
  },
  async *streamChat(
    request: ChatRequest,
    _apiKey: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, undefined> {
    const imageParts = request.messages.filter((message) => Array.isArray(message.content)).length;
    const preamble = imageParts > 0 ? '*She glances at the offered image, eyes narrowing.* ' : '';
    const tokens = chunkText(preamble + MOCK_TALE, 9);
    for (const token of tokens) {
      if (signal.aborted) {
        yield { type: 'done', finishReason: 'aborted' };
        return;
      }
      await sleep(45);
      yield { type: 'delta', text: token };
    }
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'aborted' };
      return;
    }
    yield {
      type: 'done',
      finishReason: 'stop',
      usage: { promptTokens: 128, completionTokens: 96, costUsd: 0 },
    };
  },
};
