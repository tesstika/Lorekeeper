import type {
  Chat,
  ChatDetail,
  ChatMessage,
  ChatPatch,
  ChatSummary,
  CreateChatInput,
} from '@lorekeeper/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api';
import { describeApiError } from '@/utils/errors';
import { useUiStore } from './ui';

function placeholderVariant(messageId: string, variantIndex: number) {
  return {
    id: messageId,
    variantIndex,
    isActive: true,
    text: '',
    finishReason: null,
    isError: false,
    error: null,
    usage: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Server state for chats & messages (plan §6.4): a pinia mirror with the
 * active chat detail as the conversation cache. The streaming store writes
 * deltas straight into this cache; REST mutations upsert precisely.
 */
export const useChatsStore = defineStore('chats', () => {
  const ui = useUiStore();

  const list = ref<ChatSummary[]>([]);
  const loaded = ref(false);
  const activeChat = ref<ChatDetail | null>(null);
  // Unified loading/error states (M4) for the chronicles list.
  const listLoading = ref(false);
  const listError = ref<string | null>(null);

  async function loadList(force = false): Promise<void> {
    if (loaded.value && !force) return;
    listLoading.value = true;
    try {
      list.value = await api.getChats();
      loaded.value = true;
      listError.value = null;
    } catch (error) {
      const message = describeApiError(error);
      listError.value = message;
      ui.notify(message, 'error');
    } finally {
      listLoading.value = false;
    }
  }

  async function refreshList(): Promise<void> {
    try {
      list.value = await api.getChats();
      loaded.value = true;
    } catch {
      // Silent — the list refreshes on the next navigation anyway.
    }
  }

  async function openChat(id: string): Promise<ChatDetail | null> {
    try {
      activeChat.value = await api.getChat(id);
      return activeChat.value;
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
      return null;
    }
  }

  function closeChat(): void {
    activeChat.value = null;
  }

  async function createChat(input: CreateChatInput): Promise<ChatDetail | null> {
    try {
      const detail = await api.createChat(input);
      activeChat.value = detail;
      await refreshList();
      return detail;
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
      return null;
    }
  }

  async function updateChat(id: string, patch: ChatPatch): Promise<Chat | null> {
    try {
      const chat = await api.updateChat(id, patch);
      if (activeChat.value?.chat.id === id) {
        activeChat.value = { ...activeChat.value, chat };
      }
      await refreshList();
      return chat;
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
      return null;
    }
  }

  async function removeChat(id: string): Promise<boolean> {
    const accepted = await ui.confirm({
      title: 'Delete this chronicle?',
      message: 'The conversation and all of its messages are removed. This cannot be undone.',
      confirmLabel: 'Delete chat',
      danger: true,
    });
    if (!accepted) return false;
    try {
      await api.deleteChat(id);
      if (activeChat.value?.chat.id === id) activeChat.value = null;
      await refreshList();
      ui.notify('Chronicle deleted', 'info');
      return true;
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
      return false;
    }
  }

  // -- Streaming-facing local mutations (plan §6.4) ---------------------------

  function upsertMessage(message: ChatMessage): void {
    const chat = activeChat.value;
    if (!chat) return;
    const index = chat.messages.findIndex((m) => m.seq === message.seq || m.id === message.id);
    if (index >= 0) chat.messages.splice(index, 1, message);
    else {
      chat.messages.push(message);
      chat.messages.sort((a, b) => a.seq - b.seq);
    }
  }

  /** Inserts an empty assistant group when the SSE `meta` announces a new reply. */
  function addStreamingPlaceholder(
    chatId: string,
    messageId: string,
    groupId: string,
    seq: number,
  ): void {
    const chat = activeChat.value;
    if (!chat || chat.chat.id !== chatId) return;
    if (chat.messages.some((m) => m.variants.some((v) => v.id === messageId))) return;
    chat.messages.push({
      id: messageId,
      seq,
      role: 'assistant',
      groupId,
      isGreeting: false,
      isError: false,
      error: null,
      variants: [placeholderVariant(messageId, 0)],
      activeVariantId: messageId,
      attachments: [],
      usage: null,
      finishReason: null,
    });
  }

  /** Adds the new variant to the target group when a regenerate begins. */
  function addStreamingVariant(chatId: string, messageId: string, groupId: string): void {
    const chat = activeChat.value;
    if (!chat || chat.chat.id !== chatId) return;
    const group = chat.messages.find((m) => m.groupId === groupId);
    if (!group) {
      addStreamingPlaceholder(chatId, messageId, groupId, chat.messages.length);
      return;
    }
    if (group.variants.some((v) => v.id === messageId)) return;
    for (const variant of group.variants) variant.isActive = false;
    const nextIndex = group.variants.reduce((max, v) => Math.max(max, v.variantIndex), -1) + 1;
    group.variants.push(placeholderVariant(messageId, nextIndex));
    group.activeVariantId = messageId;
    group.isError = false;
    group.error = null;
  }

  function appendDelta(chatId: string, variantId: string, text: string): void {
    const chat = activeChat.value;
    if (!chat || chat.chat.id !== chatId) return;
    for (const message of chat.messages) {
      const variant = message.variants.find((v) => v.id === variantId);
      if (variant) {
        variant.text += text;
        return;
      }
    }
  }

  function markVariantFinished(chatId: string, variantId: string, finishReason: string): void {
    const chat = activeChat.value;
    if (!chat || chat.chat.id !== chatId) return;
    for (const message of chat.messages) {
      const variant = message.variants.find((v) => v.id === variantId);
      if (variant) {
        variant.finishReason = finishReason;
        message.finishReason = finishReason;
        return;
      }
    }
  }

  /** Edit-with-regenerate: drop every turn after `seq` locally before restreaming. */
  function truncateAfter(chatId: string, seq: number): void {
    const chat = activeChat.value;
    if (!chat || chat.chat.id !== chatId) return;
    chat.messages = chat.messages.filter((m) => m.seq <= seq);
  }

  function dropMessages(chatId: string, deletedIds: string[]): void {
    const chat = activeChat.value;
    if (!chat || chat.chat.id !== chatId) return;
    const removed = new Set(deletedIds);
    chat.messages = chat.messages
      .filter((m) => !removed.has(m.id))
      .filter((m) => !m.variants.every((v) => removed.has(v.id)));
  }

  return {
    list,
    loaded,
    activeChat,
    listLoading,
    listError,
    loadList,
    refreshList,
    openChat,
    closeChat,
    createChat,
    updateChat,
    removeChat,
    upsertMessage,
    addStreamingPlaceholder,
    addStreamingVariant,
    appendDelta,
    markVariantFinished,
    truncateAfter,
    dropMessages,
  };
});
