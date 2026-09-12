import type { SseEvent } from '@lorekeeper/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ApiError } from '@/api';
import { streamGeneration } from '@/api/sse';
import { describeApiError } from '@/utils/errors';
import { useChatsStore } from './chats';
import { useSettingsStore } from './settings';
import { useUiStore } from './ui';

/**
 * Ollama pre-flight rejection (feature spec §2): the effective model is not
 * pulled yet — the chat page offers a confirmation download + retry.
 */
export interface PendingModelDownload {
  chatId: string;
  targetMessageId: string | null;
  modelTag: string;
}

/**
 * Single source of truth for the Stop button and the 409 single-flight guard
 * (plan §6.4/§7.2). One generation per chat; SSE deltas are written directly
 * into the chats store's cache.
 */
export const useStreamingStore = defineStore('streaming', () => {
  const ui = useUiStore();
  const chats = useChatsStore();
  const settings = useSettingsStore();

  const chatId = ref<string | null>(null);
  const streamingVariantId = ref<string | null>(null);
  const streamingGroupId = ref<string | null>(null);
  const isStreaming = ref(false);
  /** Set when generation was refused because the Ollama model is not pulled. */
  const pendingDownload = ref<PendingModelDownload | null>(null);
  /**
   * Terminal outcome of the last stream, taken from the SSE events themselves
   * (D9 Stage B dot tone). Derived after the fact from the local cache would
   * race the reconcile refetch, so it is recorded as events arrive.
   */
  const lastOutcome = ref<'stop' | 'aborted' | 'error'>('stop');
  let controller: AbortController | null = null;

  function clearPendingDownload(): void {
    pendingDownload.value = null;
  }

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
    lastOutcome.value = 'stop';
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
          lastOutcome.value = event.finishReason === 'aborted' ? 'aborted' : 'stop';
          break;
        }
        case 'error': {
          lastOutcome.value = 'error';
          break;
        }
      }
    };

    try {
      await streamGeneration(id, targetMessageId, { onEvent: handleEvent }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        // Stop button: the server already persisted the partial text.
        lastOutcome.value = 'aborted';
      } else if (error instanceof ApiError && error.code === 'model_not_downloaded') {
        // Must precede the generic 409 branch — the pre-flight uses 409 too.
        const modelTag = chats.activeChat?.chat.modelId ?? settings.globalDefaults.modelId ?? '';
        pendingDownload.value = { chatId: id, targetMessageId, modelTag };
      } else if (error instanceof ApiError && error.statusCode === 409) {
        ui.notify('A reply is already being written for this chat.', 'info');
      } else {
        ui.notify(describeApiError(error), 'error');
      }
    } finally {
      isStreaming.value = false;
      controller = null;
      // Reconcile with the persisted state (final text, usage, error payloads)
      // — but only while the user is still viewing this chat; otherwise the
      // refetch would clobber whichever chat they navigated to.
      if (chats.activeChat?.chat.id === id) {
        await chats.openChat(id);
      } else {
        await chats.refreshList();
      }
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
    pendingDownload,
    lastOutcome,
    start,
    stop,
    clearPendingDownload,
  };
});
