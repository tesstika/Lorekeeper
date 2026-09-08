import {
  activateVariantInputSchema,
  activateVariantResponseSchema,
  type ChatMessage,
  chatDetailSchema,
  chatPatchSchema,
  chatSchema,
  chatSummarySchema,
  chatsListQuerySchema,
  createChatInputSchema,
  deleteChatResponseSchema,
  deleteMessageQuerySchema,
  deleteMessageResponseSchema,
  editMessageInputSchema,
  editMessageResponseSchema,
  messageInputSchema,
  sendMessageResponseSchema,
} from '@lorekeeper/shared';
import { z } from 'zod';
import { isGenerating } from '../generation/session';
import {
  ChatRepoError,
  createChat,
  deleteChat,
  getChatDetail,
  getChatRow,
  type groupMessages,
  listChats,
  toChat,
  updateChat,
} from '../services/chatsRepo';
import {
  activateVariant,
  appendUserMessage,
  cleanOrphanedPendingVariants,
  deleteMessage,
  editMessage,
  getMessageRow,
  MessageRepoError,
} from '../services/messagesRepo';
import type { AppInstance } from '../types/app';
import { httpError } from '../util/http';

const idParams = z.object({ id: z.string() });
const messageParams = z.object({ id: z.string(), messageId: z.string() });

function messagePayload(grouped: ReturnType<typeof groupMessages>[number]): ChatMessage {
  return grouped;
}

export async function registerChatRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/api/chats',
    {
      schema: {
        querystring: chatsListQuerySchema,
        response: { 200: z.array(chatSummarySchema) },
      },
    },
    async (request) => listChats(app.db, request.query),
  );

  app.post(
    '/api/chats',
    {
      schema: {
        body: createChatInputSchema,
        response: { 201: chatDetailSchema },
      },
    },
    async (request, reply) => {
      const chat = (() => {
        try {
          return createChat(app.db, request.body);
        } catch (error) {
          if (error instanceof ChatRepoError && error.code === 'not_found') {
            throw httpError(404, 'not_found', error.message);
          }
          throw error;
        }
      })();
      const detail = getChatDetail(app.db, chat.id);
      if (!detail) throw httpError(500, 'internal_error', 'Chat detail vanished after creation');
      return reply.code(201).send(detailPayload(detail));
    },
  );

  app.get(
    '/api/chats/:id',
    {
      schema: {
        params: idParams,
        response: { 200: chatDetailSchema },
      },
    },
    async (request) => {
      // Lazy crash cleanup (plan §5): a server crash mid-stream leaves an empty
      // pending variant (finishReason NULL, text ''). Skipped while a
      // generation is live for this chat — an in-flight variant is pending by
      // design until finalizeVariant commits.
      if (!isGenerating(request.params.id)) {
        cleanOrphanedPendingVariants(app.db, request.params.id);
      }
      const detail = getChatDetail(app.db, request.params.id);
      if (!detail) throw httpError(404, 'not_found', `Chat ${request.params.id} does not exist`);
      return detailPayload(detail);
    },
  );

  app.patch(
    '/api/chats/:id',
    {
      schema: {
        params: idParams,
        body: chatPatchSchema,
        response: { 200: chatSchema },
      },
    },
    async (request) => {
      const chat = updateChat(app.db, request.params.id, request.body);
      if (!chat) throw httpError(404, 'not_found', `Chat ${request.params.id} does not exist`);
      return toChat(chat);
    },
  );

  app.delete(
    '/api/chats/:id',
    {
      schema: {
        params: idParams,
        response: { 200: deleteChatResponseSchema },
      },
    },
    async (request) => {
      const removed = deleteChat(app.db, request.params.id);
      if (!removed) throw httpError(404, 'not_found', `Chat ${request.params.id} does not exist`);
      return { ok: true as const };
    },
  );

  app.post(
    '/api/chats/:id/messages',
    {
      schema: {
        params: idParams,
        body: messageInputSchema,
        response: { 201: sendMessageResponseSchema },
      },
    },
    async (request, reply) => {
      assertChatExists(app, request.params.id);
      try {
        const { message } = appendUserMessage(app.db, request.params.id, request.body);
        return reply.code(201).send({ message: messageOf(app, request.params.id, message.id) });
      } catch (error) {
        throw repoToHttp(error);
      }
    },
  );

  app.post(
    '/api/chats/:id/messages/:messageId',
    {
      schema: {
        params: messageParams,
        body: editMessageInputSchema,
        response: { 200: editMessageResponseSchema },
      },
    },
    async (request) => {
      assertChatExists(app, request.params.id);
      try {
        const { updated, truncatedSeq } = editMessage(
          app.db,
          request.params.id,
          request.params.messageId,
          request.body,
        );
        return {
          message: messageOf(app, request.params.id, updated.id),
          truncatedSeq,
        };
      } catch (error) {
        throw repoToHttp(error);
      }
    },
  );

  app.delete(
    '/api/chats/:id/messages/:messageId',
    {
      schema: {
        params: messageParams,
        querystring: deleteMessageQuerySchema,
        response: { 200: deleteMessageResponseSchema },
      },
    },
    async (request) => {
      assertChatExists(app, request.params.id);
      const withReplies = request.query.withReplies !== '0';
      try {
        return deleteMessage(app.db, request.params.id, request.params.messageId, withReplies);
      } catch (error) {
        throw repoToHttp(error);
      }
    },
  );

  app.post(
    '/api/chats/:id/messages/:messageId/activate',
    {
      schema: {
        params: messageParams,
        body: activateVariantInputSchema,
        response: { 200: activateVariantResponseSchema },
      },
    },
    async (request) => {
      assertChatExists(app, request.params.id);
      const target = getMessageRow(app.db, request.params.id, request.params.messageId);
      if (!target) {
        throw httpError(404, 'not_found', `Message ${request.params.messageId} does not exist`);
      }
      if (!target.groupId) {
        throw httpError(409, 'not_a_group', 'This message has no variants to swipe');
      }
      try {
        const row = activateVariant(
          app.db,
          request.params.id,
          target.groupId,
          request.body.variantId,
        );
        return { message: messageOf(app, request.params.id, row.id) };
      } catch (error) {
        throw repoToHttp(error);
      }
    },
  );
}

function assertChatExists(app: AppInstance, chatId: string): void {
  if (!getChatRow(app.db, chatId)) {
    throw httpError(404, 'not_found', `Chat ${chatId} does not exist`);
  }
}

/** Re-reads the chat and returns the grouped message containing `messageId`. */
function messageOf(app: AppInstance, chatId: string, messageId: string): ChatMessage {
  const detail = getChatDetail(app.db, chatId);
  if (!detail) throw httpError(404, 'not_found', `Chat ${chatId} does not exist`);
  const grouped = detail.messages.find(
    (message) => message.variants.some((v) => v.id === messageId) || message.id === messageId,
  );
  if (!grouped) throw httpError(404, 'not_found', `Message ${messageId} does not exist`);
  return messagePayload(grouped);
}

function detailPayload(detail: NonNullable<ReturnType<typeof getChatDetail>>) {
  return {
    chat: toChat(detail.chat),
    character: detail.character,
    persona: detail.persona,
    messages: detail.messages.map(messagePayload),
  };
}

function repoToHttp(error: unknown): Error {
  if (error instanceof MessageRepoError) {
    if (error.code === 'not_found') return httpError(404, 'not_found', error.message);
    if (error.code === 'variant_not_active') return httpError(409, error.code, error.message);
    if (error.code === 'invalid_attachment') return httpError(400, error.code, error.message);
  }
  return error as Error;
}
