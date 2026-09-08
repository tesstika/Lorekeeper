<script setup lang="ts" vapor>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import NewChatSheet from '@/components/chat/NewChatSheet.vue';
import BottomNav from '@/components/ui/BottomNav.vue';
import { useCharactersStore } from '@/stores/characters';
import { useChatsStore } from '@/stores/chats';
import { useSettingsStore } from '@/stores/settings';
import { formatRelativeTime, initialsOf } from '@/utils/time';

const router = useRouter();
const chatsStore = useChatsStore();
const charactersStore = useCharactersStore();
const settingsStore = useSettingsStore();

const tabs = [
  { id: 'all', label: 'All Chronicles' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'archived', label: 'Archived' },
] as const;
type TabId = (typeof tabs)[number]['id'];

const activeTab = ref<TabId>('all');
const query = ref('');
const searchOpen = ref(false);
const newChatOpen = ref(false);

onMounted(() => {
  void chatsStore.loadList();
  void charactersStore.loadCharacters();
  void charactersStore.loadPersonas();
  void settingsStore.load();
});

const filteredChats = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return chatsStore.list.filter((chat) => {
    if (activeTab.value === 'in_progress' && chat.status !== 'in_progress') return false;
    if (activeTab.value === 'archived' && chat.status !== 'archived') return false;
    if (needle.length > 0) {
      const haystack = `${chat.title} ${chat.characterName}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
});

const summaryLabel = computed(() => {
  const count = filteredChats.value.length;
  if (activeTab.value === 'archived')
    return `Archive • ${count} Chronicle${count === 1 ? '' : 's'}`;
  return `Active Sanctum • ${count} Chronicle${count === 1 ? '' : 's'}`;
});

function modelPill(modelId: string | null): string {
  const effective = modelId ?? settingsStore.globalDefaults.modelId ?? 'No model';
  const short = effective.includes('/') ? (effective.split('/').pop() ?? effective) : effective;
  return short.replace(/[-_]/g, ' ');
}

function openChat(id: string): void {
  void router.push(`/chats/${id}`);
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-[390px] flex-col border-x border-outline-variant/20 bg-surface pb-24">
    <header class="sticky top-0 z-40 flex items-center justify-between bg-surface/85 px-5 pb-3 pt-9 backdrop-blur-md">
      <div class="flex items-center gap-2">
        <svg viewBox="0 0 24 24" class="size-6 fill-none stroke-primary stroke-2" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
        <h1 class="text-[22px] font-bold text-on-surface">Lorekeeper</h1>
      </div>
      <button
        type="button"
        aria-label="Search chronicles"
        class="p-1 text-secondary transition-colors hover:text-primary"
        @click="searchOpen = !searchOpen"
      >
        <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
      </button>
    </header>

    <div v-if="searchOpen" class="px-5 pb-2">
      <input
        :value="query"
        type="text"
        aria-label="Search chronicles"
        placeholder="Search titles and characters…"
        class="w-full rounded-full border border-outline-variant/40 bg-surface-container-low px-4 py-2 text-[13px] text-on-surface outline-none focus:border-primary/60"
        @input="query = ($event.target as HTMLInputElement).value"
      >
    </div>

    <nav aria-label="Chronicle filter" class="flex gap-2 overflow-x-auto border-b border-outline-variant/15 px-5 py-2">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex-shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors"
        :class="activeTab === tab.id
          ? 'border-primary/30 bg-secondary-container text-primary'
          : 'border-outline-variant/30 bg-surface-container-low text-secondary hover:text-primary'"
        @click="activeTab = tab.id"
      >
        <span v-if="activeTab === tab.id" class="mr-1 inline-block size-1.5 rounded-full bg-primary align-middle" />
        {{ tab.label }}
      </button>
    </nav>

    <div class="px-5 pb-1 pt-3">
      <div class="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-surface-container-low p-2.5">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-primary stroke-2" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" /></svg>
          <p class="text-[11px] uppercase tracking-wide text-secondary">{{ summaryLabel }}</p>
        </div>
        <span class="text-[11px] text-outline">Sorted by Recency</span>
      </div>
    </div>

    <main class="flex-1 space-y-2.5 px-5 pt-2">
      <div v-if="filteredChats.length === 0" class="flex flex-col items-center gap-1 pt-24 text-center">
        <p class="font-serif text-lg italic text-on-surface-variant/85">
          {{ query ? 'No chronicles match your search.' : 'Your library is empty.' }}
        </p>
        <p class="text-[13px] text-outline">Begin your first tale with a character.</p>
      </div>

      <article
        v-for="chat in filteredChats"
        :key="chat.id"
        class="group cursor-pointer rounded-xl border border-outline-variant/20 bg-surface-container-low p-3 transition-all duration-200 hover:border-outline-variant/40 hover:bg-surface-container"
        @click="openChat(chat.id)"
      >
        <div class="flex items-start gap-3">
          <div class="relative flex-shrink-0">
            <div class="size-[52px] rounded-full bg-gradient-to-tr from-primary-container/80 via-outline-variant/50 to-tertiary/70 p-[2px]">
              <img
                v-if="chat.characterAvatarPath"
                :src="chat.characterAvatarPath"
                :alt="chat.characterName"
                class="size-full rounded-full bg-surface-container-high object-cover"
              />
              <span v-else class="flex size-full items-center justify-center rounded-full bg-surface-container-high text-[15px] font-bold text-secondary">
                {{ initialsOf(chat.characterName) }}
              </span>
            </div>
            <span
              class="absolute bottom-0 right-0 size-3 rounded-full border-2 border-surface"
              :class="chat.status === 'in_progress' ? 'bg-primary-container' : 'bg-outline'"
              aria-hidden="true"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex items-baseline justify-between gap-1">
              <h2 class="truncate text-[15px] font-semibold text-on-surface transition-colors group-hover:text-primary">
                {{ chat.title }}
              </h2>
              <time class="flex-shrink-0 text-[11px] text-outline">{{ formatRelativeTime(chat.lastMessageAt) }}</time>
            </div>
            <div class="mb-1.5 flex items-center gap-2">
              <span class="rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 text-[10px] tracking-wide text-on-surface-variant">
                {{ modelPill(chat.modelId) }}
              </span>
              <span v-if="chat.status === 'archived'" class="text-[10px] text-outline/60">• Archived</span>
            </div>
            <p class="line-clamp-1 font-serif text-[13px] italic tracking-normal text-secondary">
              {{ chat.lastMessagePreview ?? 'The page awaits its first word.' }}
            </p>
          </div>
        </div>
      </article>
    </main>

    <button
      type="button"
      aria-label="Begin a New Tale"
      class="fixed bottom-24 right-5 z-40 mx-auto flex w-[calc(100%-2.5rem)] max-w-[340px] items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-[15px] font-semibold text-on-primary shadow-lg transition active:scale-95"
      @click="newChatOpen = true"
    >
      <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      New Tale
    </button>

    <NewChatSheet
      :open="newChatOpen"
      @close="newChatOpen = false"
      @created="(chatId) => openChat(chatId)"
    />

    <BottomNav />
  </div>
</template>
