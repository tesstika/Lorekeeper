import type { SseEvent } from '@lorekeeper/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ApiError } from '@/api';
import { streamGeneration } from '@/api/sse';
import { describeApiError } from '@/utils/errors';
import { useChatsStore } from './chats';
import { useUiStore } from './ui';

/**
 * Single source of truth for the Stop button and the 409 single-flight guard
 * (plan §6.4/§7.2). One generation per chat; SSE deltas are written directly
 * into the chats store's cache.
 */
export const useStreamingStore = defineStore('streaming', () => {
  const ui = useUiStore();
  const chats = useChatsStore();

  const chatId = ref<string | null>(null);
  const streamingVariantId = ref<string | null>(null);
  const streamingGroupId = ref<string | null>(null);
  const isStreaming = ref(false);
  let controller: AbortController | null = null;

  async function start(options: {
    chatId: string;
    targetMessageId?: string | null;
  }): Promise<void> {
    if (isStreaming.value) return;
    const { chatId: id, targetMessageId = null } = options;
    isStreaming.value = true;
    chatId.value = id;
    streamingVariantId.value = null;
    streamingGroupId.value = null;
    controller = new AbortController();

    const handleEvent = (event: SseEvent): void => {
      switch (event.type) {
        case 'meta': {
          streamingVariantId.value = event.messageId;
          streamingGroupId.value = event.groupId;
          if (targetMessageId) {
            chats.addStreamingVariant(id, event.messageId, event.groupId);
          } else {
            chats.addStreamingPlaceholder(id, event.messageId, event.groupId, event.seq);
          }
          break;
        }
        case 'delta': {
          if (streamingVariantId.value) {
            chats.appendDelta(id, streamingVariantId.value, event.text);
          }
          break;
        }
        case 'done': {
          if (streamingVariantId.value) {
            chats.markVariantFinished(id, streamingVariantId.value, event.finishReason);
          }
          break;
        }
        case 'error': {
          // The server persisted the error variant; the refetch below paints it.
          break;
        }
      }
    };

    try {
      await streamGeneration(id, targetMessageId, { onEvent: handleEvent }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        // Stop button: the server already persisted the partial text.
      } else if (error instanceof ApiError && error.statusCode === 409) {
        ui.notify('A reply is already being written for this chat.', 'info');
      } else {
        ui.notify(describeApiError(error), 'error');
      }
    } finally {
      isStreaming.value = false;
      controller = null;
      // Reconcile with the persisted state (final text, usage, error payloads).
      await chats.openChat(id);
      chatId.value = null;
      streamingVariantId.value = null;
      streamingGroupId.value = null;
    }
  }

  function stop(): void {
    controller?.abort();
  }

  return {
    chatId,
    streamingVariantId,
    streamingGroupId,
    isStreaming,
    start,
    stop,
  };
});
