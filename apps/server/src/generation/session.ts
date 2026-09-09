import type { ChatError, TokenUsage } from '@lorekeeper/shared';
import type { LorekeeperDb } from '../db/client';
import { getProvider } from '../providers';
import { ProviderError } from '../providers/types';
import type { KeyStore } from '../services/keyStore';
import {
  createAssistantVariant,
  finalizeVariant,
  getMessageRow,
  type MessageRow,
} from '../services/messagesRepo';
import type { SseWriter } from './sseWriter';

// Single-flight state + config resolution live in `config.ts` so the prompt
// preview route shares the exact same logic (M4). Re-exported here for the
// established import surface.
export { isGenerating, resolveGenerationConfig, SessionConfigError } from './config';

import { getChatRow } from '../services/chatsRepo';
import {
  activeGenerations,
  type ResolvedGenerationConfig,
  resolveGenerationConfig,
  SessionConfigError,
} from './config';
import { loadPromptInputs } from './promptInputs';

// ---------------------------------------------------------------------------
// Generation session (plan §5, §6.7, §6.8, §7.2):
//   single-flight per chat → assemble prompt → persist pending variant →
//   SSE meta/delta/done|error with heartbeat + idle watchdog → persist final.
// ---------------------------------------------------------------------------

export const HEARTBEAT_MS = 15_000;
export const IDLE_TIMEOUT_MS = 30_000;
export const IDLE_CHECK_MS = 5_000;

export interface SessionOptions {
  db: LorekeeperDb;
  dataDir: string;
  keyStore: KeyStore;
  writer: SseWriter;
  chatId: string;
  /** Regenerate: adds a variant to this assistant message's group. */
  targetMessageId?: string | null;
  heartbeatMs?: number;
  idleTimeoutMs?: number;
  idleCheckMs?: number;
  keepLastNVariants?: number;
}

export interface SessionOutcome {
  status: 'completed' | 'aborted' | 'error';
  messageId: string | null;
  finishReason: 'stop' | 'length' | 'aborted' | 'error' | null;
  error: ChatError | null;
}

interface PendingTarget {
  row: MessageRow;
  seq: number;
  groupId: string;
}

function prepareTarget(options: SessionOptions): PendingTarget | null {
  if (!options.targetMessageId) return null;
  const target = getMessageRow(options.db, options.chatId, options.targetMessageId);
  if (!target) {
    throw new SessionConfigError('not_found', 'The message to regenerate does not exist');
  }
  if (target.role !== 'assistant' || !target.groupId) {
    throw new SessionConfigError(
      'invalid_target',
      'Only assistant messages can be regenerated into new variants',
    );
  }
  return { row: target, seq: target.seq, groupId: target.groupId };
}

function toChatError(
  error: unknown,
  providerId: ResolvedGenerationConfig['providerId'],
  modelId: string,
): ChatError {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      providerId,
      modelId,
      ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'aborted', message: 'Generation aborted', providerId, modelId };
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
    providerId,
    modelId,
  };
}

function mapFinishReason(reason: string | null): 'stop' | 'length' | 'aborted' {
  if (reason === 'length') return 'length';
  if (reason === 'aborted') return 'aborted';
  return 'stop'; // 'stop' | 'tool_calls' | null
}

/**
 * Runs one generation against `writer`. All failures become persisted error
 * variants + an SSE `error` event, so the client never waits on a dangling
 * connection (D10). Lookup-only failures (`not_found`) skip persistence since
 * there is no thread to attach the error to.
 */
export async function runGenerationSession(options: SessionOptions): Promise<SessionOutcome> {
  const { db, writer, chatId } = options;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const idleCheckMs = options.idleCheckMs ?? IDLE_CHECK_MS;

  let target: PendingTarget | null = null;

  const failFast = (error: ChatError, persist: boolean): SessionOutcome => {
    if (persist) {
      try {
        const row = createAssistantVariant(db, chatId, {
          ...(target ? { groupId: target.groupId } : {}),
        });
        finalizeVariant(db, row.id, {
          text: '',
          finishReason: 'error',
          isError: true,
          error,
        });
      } catch {
        // Nothing more we can do — still report the error to the client.
      }
    }
    writer.writeEvent({ type: 'error', ...error });
    writer.end();
    return { status: 'error', messageId: null, finishReason: 'error', error };
  };

  const chat = getChatRow(db, chatId);
  if (!chat) {
    return failFast({ code: 'not_found', message: `Chat ${chatId} does not exist` }, false);
  }

  let config: ResolvedGenerationConfig;
  try {
    config = resolveGenerationConfig(db, chat);
    target = prepareTarget(options);
  } catch (error) {
    if (error instanceof SessionConfigError) {
      return failFast(
        { code: error.code, message: error.message },
        error.code !== 'not_found' && error.code !== 'invalid_target',
      );
    }
    throw error;
  }

  // Key check stays outside loadPromptInputs so `no_key` persists a bubble.
  if (!options.keyStore.hasKey(config.providerId)) {
    return failFast(
      {
        code: 'no_key',
        message:
          'No API key stored for the configured provider — add one in Settings → API Providers & Keys.',
        providerId: config.providerId,
        modelId: config.modelId,
      },
      true,
    );
  }

  let assembled: ReturnType<typeof loadPromptInputs>['assembled'];
  try {
    ({ assembled } = loadPromptInputs(db, options.dataDir, chat, {
      ...(target ? { cutoffSeq: target.seq } : {}),
    }));
  } catch (error) {
    if (error instanceof SessionConfigError) {
      return failFast(
        { code: error.code, message: error.message },
        error.code !== 'not_found' && error.code !== 'invalid_target',
      );
    }
    throw error;
  }
  assembled.request.model = config.modelId;
  if (config.providerId === 'openrouter') assembled.request.includeUsage = true;

  // Pending assistant row: created active; regenerate joins the target group.
  let variantRow: MessageRow;
  try {
    variantRow = createAssistantVariant(db, chatId, {
      ...(target ? { groupId: target.groupId } : {}),
      providerId: config.providerId,
      modelId: config.modelId,
      keepLastNVariants: options.keepLastNVariants,
    });
  } catch (error) {
    return failFast(
      {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Could not create the assistant variant',
      },
      false,
    );
  }

  // D-T3 invariant: this add() must stay in the same synchronous block as the
  // route's isGenerating() check (all repo calls below are synchronous SQLite
  // — no await may be inserted before this line, or the 409 single-flight
  // race reopens silently).
  activeGenerations.add(chatId);
  const controller = new AbortController();
  let clientClosed = false;
  writer.onClientClose(() => {
    clientClosed = true;
    controller.abort();
  });

  writer.writeEvent({
    type: 'meta',
    messageId: variantRow.id,
    groupId: variantRow.groupId ?? '',
    seq: variantRow.seq,
  });

  let buffer = '';
  let lastDataAt = Date.now();
  let idleFired = false;
  const heartbeat = setInterval(() => writer.writeComment('ping'), heartbeatMs);
  const idleWatchdog = setInterval(() => {
    if (Date.now() - lastDataAt > idleTimeoutMs) {
      idleFired = true;
      controller.abort();
    }
  }, idleCheckMs);

  let outcome: SessionOutcome;
  try {
    const provider = getProvider(config.providerId);
    const apiKey = options.keyStore.decrypt(config.providerId);
    let doneUsage: TokenUsage | undefined;
    let doneReason: string | null = null;
    let streamError: { event: unknown; error: ChatError } | null = null;
    let thrown: unknown = null;

    try {
      for await (const event of provider.streamChat(assembled.request, apiKey, controller.signal)) {
        if (event.type === 'delta') {
          buffer += event.text;
          lastDataAt = Date.now();
          writer.writeEvent({ type: 'delta', text: event.text });
        } else if (event.type === 'done') {
          doneReason = event.finishReason;
          doneUsage = event.usage;
          break;
        } else {
          streamError = {
            event,
            error: {
              code: event.code,
              message: event.message,
              providerId: config.providerId,
              modelId: config.modelId,
              ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
              ...(event.retryAfterMs !== undefined ? { retryAfterMs: event.retryAfterMs } : {}),
            },
          };
          break;
        }
      }
    } catch (error) {
      thrown = error;
    }

    // The watchdog aborts after >idleTimeoutMs of silence. Providers report an
    // abort either by throwing AbortError or by ending with done('aborted')
    // (openaiCompat catches mid-stream aborts) — classify both as idle_timeout
    // unless the CLIENT closed (a user Stop always wins).
    if (
      idleFired &&
      !clientClosed &&
      !streamError &&
      (doneReason === null || doneReason === 'aborted')
    ) {
      thrown = new ProviderError(
        'idle_timeout',
        `Provider sent no data for over ${Math.round(idleTimeoutMs / 1000)}s — stream aborted`,
      );
    }

    if (streamError) {
      finalizeVariant(db, variantRow.id, {
        text: buffer,
        finishReason: 'error',
        isError: true,
        error: streamError.error,
      });
      writer.writeEvent({ type: 'error', ...streamError.error });
      outcome = {
        status: 'error',
        messageId: variantRow.id,
        finishReason: 'error',
        error: streamError.error,
      };
    } else if (thrown) {
      // A client Stop must persist partial text as 'aborted', never 'error'.
      const aborted = clientClosed || (thrown instanceof Error && thrown.name === 'AbortError');
      if (aborted) {
        finalizeVariant(db, variantRow.id, {
          text: buffer,
          finishReason: 'aborted',
          ...(doneUsage ? { usage: doneUsage } : {}),
        });
        outcome = {
          status: 'aborted',
          messageId: variantRow.id,
          finishReason: 'aborted',
          error: null,
        };
      } else {
        const error = toChatError(thrown, config.providerId, config.modelId);
        finalizeVariant(db, variantRow.id, {
          text: buffer,
          finishReason: 'error',
          isError: true,
          error,
        });
        writer.writeEvent({ type: 'error', ...error });
        outcome = { status: 'error', messageId: variantRow.id, finishReason: 'error', error };
      }
    } else {
      // A generator that ends without a done event after a client abort is an
      // aborted stream, not a successful one.
      const finishReason = clientClosed ? 'aborted' : mapFinishReason(doneReason);
      finalizeVariant(db, variantRow.id, {
        text: buffer,
        finishReason,
        ...(doneUsage ? { usage: doneUsage } : {}),
      });
      if (!clientClosed) {
        writer.writeEvent({
          type: 'done',
          finishReason,
          ...(doneUsage ? { usage: doneUsage } : {}),
        });
      }
      outcome = {
        status: finishReason === 'aborted' ? 'aborted' : 'completed',
        messageId: variantRow.id,
        finishReason,
        error: null,
      };
    }
  } finally {
    clearInterval(heartbeat);
    clearInterval(idleWatchdog);
    activeGenerations.delete(chatId);
    writer.end();
  }
  return outcome;
}
