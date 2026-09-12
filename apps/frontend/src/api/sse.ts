import type { OllamaPullProgressEvent, SseEvent } from '@lorekeeper/shared';
import { parseSseFrames } from '@lorekeeper/shared';
import { ApiError } from './index';

export interface StreamHandlers {
  onEvent: (event: SseEvent) => void;
}

async function raiseApiError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
  } | null;
  throw new ApiError(
    body?.message ?? `Stream failed with HTTP ${response.status}`,
    response.status,
    body?.code ?? 'http_error',
  );
}

/**
 * POSTs to a generation endpoint and consumes the SSE stream (plan §2.2/D1):
 * fetch + ReadableStream so an AbortSignal doubles as the Stop button.
 * A final `done` or `error` event always closes the stream.
 */
export async function streamGeneration(
  chatId: string,
  targetMessageId: string | null,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const path = targetMessageId
    ? `/chats/${chatId}/messages/${targetMessageId}/regenerate`
    : `/chats/${chatId}/generate`;
  const response = await fetch(`/api${path}`, { method: 'POST', signal });
  if (!response.ok) await raiseApiError(response);
  if (!response.body) throw new ApiError('Empty stream body', 502, 'empty_stream');

  for await (const frame of parseSseFrames(response.body)) {
    if (!frame.data) continue; // comment heartbeat
    try {
      handlers.onEvent(JSON.parse(frame.data) as SseEvent);
    } catch {
      // Malformed frame — skip rather than break the stream.
    }
  }
}

export interface OllamaPullHandlers {
  onProgress: (event: OllamaPullProgressEvent) => void;
}

/**
 * POSTs a curated-model pull and consumes the progress SSE stream (feature
 * spec §2): frames carry `{ modelTag, status, completed?, total?, error? }`.
 * Resolves when the stream ends (success or error frame); the abort signal
 * cancels the upstream pull.
 */
export async function streamOllamaPull(
  modelTag: string,
  handlers: OllamaPullHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/providers/ollama/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelTag }),
    signal,
  });
  if (!response.ok) await raiseApiError(response);
  if (!response.body) throw new ApiError('Empty stream body', 502, 'empty_stream');

  for await (const frame of parseSseFrames(response.body)) {
    if (!frame.data) continue;
    try {
      handlers.onProgress(JSON.parse(frame.data) as OllamaPullProgressEvent);
    } catch {
      // Malformed frame — skip rather than break the stream.
    }
  }
}
