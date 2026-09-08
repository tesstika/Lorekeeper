<script setup lang="ts" vapor>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BottomSheet from '@/components/ui/BottomSheet.vue';
import { useChatsStore } from '@/stores/chats';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const chatsStore = useChatsStore();
const router = useRouter();

const title = ref('');
const ribbon = ref('');

watch(
  () => props.open,
  (open) => {
    if (open && chatsStore.activeChat) {
      title.value = chatsStore.activeChat.chat.title;
      ribbon.value = chatsStore.activeChat.chat.ribbon ?? '';
    }
  },
);

async function save(): Promise<void> {
  const chat = chatsStore.activeChat?.chat;
  if (!chat) return;
  await chatsStore.updateChat(chat.id, {
    ...(title.value.trim() !== chat.title && title.value.trim().length > 0
      ? { title: title.value.trim() }
      : {}),
    ...(ribbon.value !== (chat.ribbon ?? '') ? { ribbon: ribbon.value } : {}),
  });
  emit('close');
}

async function toggleArchive(): Promise<void> {
  const chat = chatsStore.activeChat?.chat;
  if (!chat) return;
  await chatsStore.updateChat(chat.id, {
    status: chat.status === 'archived' ? 'in_progress' : 'archived',
  });
  emit('close');
}

async function removeChat(): Promise<void> {
  const chat = chatsStore.activeChat?.chat;
  if (!chat) return;
  const removed = await chatsStore.removeChat(chat.id);
  if (removed) {
    emit('close');
    await router.push('/chats');
  }
}
</script>

<template>
  <!-- Caller-side gate: see NewChatSheet (vapor interop slot leak). -->
  <BottomSheet v-if="props.open" :open="true" title="Chronicle Settings" @close="emit('close')">
    <label class="block text-[12px] font-medium text-on-surface-variant" for="chat-title">Title</label>
    <input
      id="chat-title"
      :value="title"
      type="text"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @input="title = ($event.target as HTMLInputElement).value"
    >

    <label class="mt-3 block text-[12px] font-medium text-on-surface-variant" for="chat-ribbon">Context ribbon</label>
    <input
      id="chat-ribbon"
      :value="ribbon"
      type="text"
      placeholder="Chapter IV: The Midnight Seal"
      class="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
      @input="ribbon = ($event.target as HTMLInputElement).value"
    >

    <div class="mt-5 flex flex-col gap-2">
      <button
        type="button"
        class="w-full rounded-full bg-primary-container py-2.5 text-[13px] font-semibold text-on-primary-container transition active:scale-95"
        @click="save()"
      >Save changes</button>
      <button
        type="button"
        class="w-full rounded-full border border-outline-variant/40 py-2.5 text-[13px] text-on-surface transition-colors hover:border-primary/50"
        @click="toggleArchive()"
      >
        {{ chatsStore.activeChat?.chat.status === 'archived' ? 'Move back to In Progress' : 'Archive chronicle' }}
      </button>
      <button
        type="button"
        class="w-full rounded-full border border-error/40 py-2.5 text-[13px] text-error transition-colors hover:bg-error/10"
        @click="removeChat()"
      >Delete chronicle</button>
    </div>
  </BottomSheet>
</template>
