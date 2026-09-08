import { z } from 'zod';
import { isGenerating, runGenerationSession } from '../generation/session';
import { createSseWriter } from '../generation/sseWriter';
import { getChatRow } from '../services/chatsRepo';
import { KeyStore } from '../services/keyStore';
import type { AppInstance } from '../types/app';
import { httpError } from '../util/http';

const idParams = z.object({ id: z.string() });
const messageParams = z.object({ id: z.string(), messageId: z.string() });

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
    if (isGenerating(chatId)) {
      throw httpError(
        409,
        'generation_in_progress',
        'A generation is already running for this chat — stop it first.',
      );
    }
    if (!getChatRow(app.db, chatId)) {
      throw httpError(404, 'not_found', `Chat ${chatId} does not exist`);
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
      if (isGenerating(chatId)) {
        throw httpError(
          409,
          'generation_in_progress',
          'A generation is already running for this chat — stop it first.',
        );
      }
      if (!getChatRow(app.db, chatId)) {
        throw httpError(404, 'not_found', `Chat ${chatId} does not exist`);
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
