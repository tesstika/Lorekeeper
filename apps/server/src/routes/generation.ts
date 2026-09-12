import { z } from 'zod';
import type { LorekeeperDb } from '../db/client';
import {
  isGenerating,
  resolveGenerationConfig,
  runGenerationSession,
  SessionConfigError,
} from '../generation/session';
import { createSseWriter } from '../generation/sseWriter';
import {
  fetchOllamaStatus,
  isOllamaModelPulled,
  OLLAMA_OFFLINE_MESSAGE,
} from '../providers/ollama';
import type { ChatRow } from '../services/chatsRepo';
import { getChatRow } from '../services/chatsRepo';
import { KeyStore } from '../services/keyStore';
import type { AppInstance } from '../types/app';
import { httpError } from '../util/http';

const idParams = z.object({ id: z.string() });
const messageParams = z.object({ id: z.string(), messageId: z.string() });

/**
 * Ollama pre-flight (feature spec §2): daemon down → 503 `ollama_offline`;
 * model not pulled → 409 `model_not_downloaded` so the client can offer the
 * download instead of a silent freeze. MUST run before the single-flight
 * check — its awaits would reopen the check→add() race window (D-T3) if they
 * sat between `isGenerating()` and the session's `activeGenerations.add()`.
 * Config-resolution failures are skipped here; the session reports them with
 * persisted error bubbles.
 */
async function preflightOllama(db: LorekeeperDb, chat: ChatRow): Promise<void> {
  let config: ReturnType<typeof resolveGenerationConfig>;
  try {
    config = resolveGenerationConfig(db, chat);
  } catch (error) {
    if (error instanceof SessionConfigError) return;
    throw error;
  }
  if (config.providerId !== 'ollama') return;
  const status = await fetchOllamaStatus();
  if (!status.running) {
    throw httpError(503, 'ollama_offline', OLLAMA_OFFLINE_MESSAGE);
  }
  if (!(await isOllamaModelPulled(config.modelId))) {
    throw httpError(
      409,
      'model_not_downloaded',
      `The model "${config.modelId}" is not downloaded yet — download it to start this reply.`,
    );
  }
}

/**
 * SSE generation endpoints (plan §7.2). Both stream `text/event-stream` over a
 * hijacked reply. Pre-flight failures (409 single-flight, 404 chat) are thrown
 * BEFORE the hijack so the normal JSON error contract applies; everything
 * after the stream opens surfaces as `error` events (D10).
 */
export async function registerGenerationRoutes(app: AppInstance): Promise<void> {
  const keyStore = new KeyStore(app.db);

  app.post('/api/chats/:id/generate', { schema: { params: idParams } }, async (request, reply) => {
    const chatId = request.params.id;
    const chat = getChatRow(app.db, chatId);
    if (!chat) {
      throw httpError(404, 'not_found', `Chat ${chatId} does not exist`);
    }
    await preflightOllama(app.db, chat);
    if (isGenerating(chatId)) {
      throw httpError(
        409,
        'generation_in_progress',
        'A generation is already running for this chat — stop it first.',
      );
    }
    const writer = createSseWriter(reply);
    await runGenerationSession({
      db: app.db,
      dataDir: app.dataDir,
      keyStore,
      writer,
      chatId,
      targetMessageId: null,
    });
  });

  app.post(
    '/api/chats/:id/messages/:messageId/regenerate',
    { schema: { params: messageParams } },
    async (request, reply) => {
      const chatId = request.params.id;
      const targetMessageId = request.params.messageId;
      const chat = getChatRow(app.db, chatId);
      if (!chat) {
        throw httpError(404, 'not_found', `Chat ${chatId} does not exist`);
      }
      await preflightOllama(app.db, chat);
      if (isGenerating(chatId)) {
        throw httpError(
          409,
          'generation_in_progress',
          'A generation is already running for this chat — stop it first.',
        );
      }
      const writer = createSseWriter(reply);
      await runGenerationSession({
        db: app.db,
        dataDir: app.dataDir,
        keyStore,
        writer,
        chatId,
        targetMessageId,
      });
    },
  );
}
