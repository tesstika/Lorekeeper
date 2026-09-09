<script setup lang="ts" vapor>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import ChatComposer from '@/components/chat/ChatComposer.vue';
import ChatSettingsSheet from '@/components/chat/ChatSettingsSheet.vue';
import ContextRibbon from '@/components/chat/ContextRibbon.vue';
import MessageItem from '@/components/chat/MessageItem.vue';
import MessageList from '@/components/chat/MessageList.vue';
import PromptPreviewModal from '@/components/chat/PromptPreviewModal.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import { useCharactersStore } from '@/stores/characters';
import { useChatsStore } from '@/stores/chats';
import { useSettingsStore } from '@/stores/settings';
import { useStreamingStore } from '@/stores/streaming';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const chatsStore = useChatsStore();
const charactersStore = useCharactersStore();
const settingsStore = useSettingsStore();
const streaming = useStreamingStore();

const sheetOpen = ref(false);
const previewOpen = ref(false);
/** The variant that finished most recently (drives the delivered blink). */
const justFinished = ref<{ variantId: string; tone: 'stop' | 'aborted' | 'error' } | null>(null);
const justFinishedTimer = ref<ReturnType<typeof setTimeout> | null>(null);

const chatId = computed(() => String(route.params.id ?? ''));
const detail = computed(() => chatsStore.activeChat);

onMounted(async () => {
  await settingsStore.load();
  const loaded = await chatsStore.openChat(chatId.value);
  if (!loaded) {
    router.replace('/chats');
    return;
  }
  await charactersStore.loadCharacters();
});

watch(chatId, async (id) => {
  if (id && detail.value?.chat.id !== id) await chatsStore.openChat(id);
});

const character = computed(() => detail.value?.character ?? null);
const personaName = computed(() => detail.value?.persona?.name ?? null);

const effectiveModelLabel = computed(() => {
  const modelId = detail.value?.chat.modelId ?? settingsStore.globalDefaults.modelId;
  if (!modelId) return 'No model';
  const short = modelId.includes('/') ? (modelId.split('/').pop() ?? modelId) : modelId;
  return short.replace(/[-_]/g, ' ');
});

const composer = computed(() => settingsStore.composer);

const turnCount = computed(() => {
  const messages = detail.value?.messages ?? [];
  if (messages.length === 0) return 0;
  return (messages.at(-1)?.seq ?? -1) + 1;
});

/** Vision gating for the effective model: yes / no / unknown (A1). */
const visionState = computed<'yes' | 'no' | 'unknown'>(() => {
  const modelId = detail.value?.chat.modelId ?? settingsStore.globalDefaults.modelId;
  const providerId = detail.value?.chat.providerId ?? settingsStore.globalDefaults.providerId;
  if (!modelId || !providerId) return 'unknown';
  const info = settingsStore.modelCatalog[providerId]?.models.find((model) => model.id === modelId);
  if (!info || info.inputModalities.length === 0) return 'unknown';
  return info.inputModalities.includes('image') ? 'yes' : 'no';
});

const lastGroup = computed(() => detail.value?.messages.at(-1) ?? null);
const lastAssistant = computed(() => {
  const messages = detail.value?.messages ?? [];
  return [...messages].reverse().find((m) => m.role === 'assistant') ?? null;
});
const lastReplyFailed = computed(() => lastAssistant.value?.isError === true);

const watchKey = computed(() => {
  const messages = detail.value?.messages ?? [];
  let key = `${messages.length}:${streaming.isStreaming ? 'live' : 'idle'}`;
  const last = messages.at(-1);
  if (last) {
    const variant = last.variants.find((v) => v.id === last.activeVariantId) ?? null;
    key += `:${variant?.text.length ?? 0}`;
  }
  return key;
});

function markJustFinished(variantId: string, tone: 'stop' | 'aborted' | 'error'): void {
  justFinished.value = { variantId, tone };
  if (justFinishedTimer.value) clearTimeout(justFinishedTimer.value);
  justFinishedTimer.value = setTimeout(() => {
    justFinished.value = null;
  }, 6000);
}

watch(
  () => streaming.isStreaming,
  (live, wasLive) => {
    if (wasLive && !live && streaming.streamingVariantId) {
      // Tone comes from the SSE terminal event itself (store.lastOutcome) —
      // the local cache is not yet reconciled when this watcher runs.
      markJustFinished(streaming.streamingVariantId, streaming.lastOutcome);
    }
  },
);

async function onSend(payload: { text: string; attachmentIds: string[] }): Promise<void> {
  const id = chatId.value;
  try {
    const { message } = await api.sendMessage(id, {
      text: payload.text,
      ...(payload.attachmentIds.length > 0 ? { attachmentIds: payload.attachmentIds } : {}),
    });
    chatsStore.upsertMessage(message);
    await streaming.start({ chatId: id });
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

async function onRegenerate(messageId: string): Promise<void> {
  await streaming.start({ chatId: chatId.value, targetMessageId: messageId });
}

async function onRetry(messageId: string): Promise<void> {
  await onRegenerate(messageId);
}

async function onSave(
  messageId: string,
  payload: { text: string; regenerateAfter: boolean },
): Promise<void> {
  try {
    const { message, truncatedSeq } = await api.editMessage(chatId.value, messageId, payload);
    chatsStore.upsertMessage(message);
    if (truncatedSeq !== null) {
      chatsStore.truncateAfter(chatId.value, truncatedSeq);
      await streaming.start({ chatId: chatId.value });
    }
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

async function onDelete(messageId: string, withReplies: boolean): Promise<void> {
  try {
    const { deletedIds } = await api.deleteMessage(chatId.value, messageId, withReplies);
    chatsStore.dropMessages(chatId.value, deletedIds);
    await chatsStore.openChat(chatId.value);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}

async function onActivate(messageId: string, variantId: string): Promise<void> {
  try {
    const { message } = await api.activateVariant(chatId.value, messageId, variantId);
    chatsStore.upsertMessage(message);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  }
}
</script>

<template>
  <div class="mx-auto flex h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface">
    <header class="z-40 border-b border-outline-variant/30 px-4 pb-2 pt-9">
      <nav class="flex items-center justify-between">
        <button
          type="button"
          aria-label="Back to chats"
          class="p-1 text-on-surface transition-colors hover:text-primary"
          @click="router.push('/chats')"
        >
          <svg viewBox="0 0 24 24" class="size-6 fill-none stroke-current stroke-2"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2">
          <div class="size-8 flex-shrink-0 overflow-hidden rounded-full bg-surface-container ring-1 ring-primary/40">
            <img v-if="character?.avatarPath" :src="character.avatarPath" :alt="character.name" class="size-full object-cover" />
            <span v-else class="flex size-full items-center justify-center text-[11px] font-bold text-secondary">
              {{ (character?.name ?? '?').slice(0, 1).toUpperCase() }}
            </span>
          </div>
          <span class="truncate text-[15px] font-semibold text-on-surface">
            {{ detail?.chat.title ?? character?.name ?? '…' }}
          </span>
          <span class="flex flex-shrink-0 items-center gap-1 rounded-full border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 text-[10.5px] font-medium text-primary">
            <span
              class="size-1.5 rounded-full bg-primary"
              :class="streaming.isStreaming ? 'animate-pulse' : ''"
            />
            {{ effectiveModelLabel }}
          </span>
        </div>
        <button
          type="button"
          aria-label="Prompt preview — what the model sees"
          title="Prompt preview"
          class="p-1.5 text-on-surface-variant transition-colors hover:text-primary"
          @click="previewOpen = true"
        >
          <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2"><path d="M15 12h-5" /><path d="M15 8h-5" /><path d="M19 17V5a2 2 0 0 0-2-2H4" /><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" /></svg>
        </button>
        <button
          type="button"
          aria-label="Chat settings"
          class="p-1.5 text-on-surface-variant transition-colors hover:text-primary"
          @click="sheetOpen = true"
        >
          <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </nav>
    </header>

    <ContextRibbon :ribbon="detail?.chat.ribbon ?? null" :turn="turnCount" />

    <template v-if="detail">
      <div v-if="lastReplyFailed && !streaming.isStreaming" class="flex items-center justify-between px-5 py-1.5 text-[12px] text-error">
        <span>Last reply failed.</span>
        <button
          type="button"
          class="font-medium underline underline-offset-2 hover:text-on-surface"
          @click="lastAssistant && onRetry(lastAssistant.id)"
        >Retry?</button>
      </div>

      <MessageList :watch-key="watchKey" :auto-scroll="composer.autoScroll">
        <MessageItem
          v-for="message in detail.messages"
          :key="`${message.groupId ?? message.id}:${message.seq}`"
          :message="message"
          :display-name="message.role === 'user' ? (personaName ?? 'You') : (character?.name ?? 'Character')"
          :avatar-path="message.role === 'user' ? null : (character?.avatarPath ?? null)"
          :tone="message.role === 'user' ? 'user' : 'character'"
          :streaming-variant-id="streaming.isStreaming ? streaming.streamingVariantId : null"
          :caret-blink-ms="composer.caretBlinkMs"
          :just-finished-tone="message.activeVariantId === justFinished?.variantId ? justFinished.tone : null"
          :can-regenerate="true"
          :busy="streaming.isStreaming"
          @save="(payload) => onSave(message.id, payload)"
          @delete="(withReplies) => onDelete(message.id, withReplies)"
          @regenerate="onRegenerate(message.id)"
          @retry="onRetry(message.id)"
          @activate="(variantId) => onActivate(message.id, variantId)"
        />
      </MessageList>

      <ChatComposer
        :enter-to-send="composer.enterToSend"
        :vision-state="visionState"
        @send="onSend"
      />
    </template>
    <div v-else class="flex flex-1 items-center justify-center">
      <p class="font-serif text-[15px] italic text-on-surface-variant/70">Opening the chronicle…</p>
    </div>

    <ChatSettingsSheet :open="sheetOpen" @close="sheetOpen = false" />
    <PromptPreviewModal
      :open="previewOpen"
      :chat-id="chatId"
      @close="previewOpen = false"
    />
    <ToastHost />
    <ConfirmDialog />
  </div>
</template>
