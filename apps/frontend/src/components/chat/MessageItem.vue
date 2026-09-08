<script setup lang="ts" vapor>
import type { ChatMessage } from '@lorekeeper/shared';
import { computed, ref } from 'vue';
import { useUiStore } from '@/stores/ui';
import DeliveredDot from './DeliveredDot.vue';
import ErrorBubble from './ErrorBubble.vue';
import ImageGrid from './ImageGrid.vue';
import MessageActions from './MessageActions.vue';
import MessageBody from './MessageBody.vue';
import VariantSwitcher from './VariantSwitcher.vue';

const props = withDefaults(
  defineProps<{
    message: ChatMessage;
    displayName: string;
    avatarPath: string | null;
    tone: 'character' | 'user';
    streamingVariantId?: string | null;
    caretBlinkMs?: number;
    justFinishedTone?: 'stop' | 'aborted' | 'error' | null;
    canRegenerate?: boolean;
    busy?: boolean;
  }>(),
  {
    streamingVariantId: null,
    caretBlinkMs: 500,
    justFinishedTone: null,
    canRegenerate: false,
    busy: false,
  },
);

const emit = defineEmits<{
  save: [payload: { text: string; regenerateAfter: boolean }];
  delete: [withReplies: boolean];
  retry: [];
  regenerate: [];
  activate: [variantId: string];
}>();

const ui = useUiStore();

const activeVariant = computed(() => {
  const variants = props.message.variants;
  return variants.find((v) => v.id === props.message.activeVariantId) ?? variants.at(-1) ?? null;
});
const isStreaming = computed(
  () =>
    props.streamingVariantId !== null &&
    props.message.variants.some((v) => v.id === props.streamingVariantId),
);
const timeLabel = computed(() => {
  const iso = activeVariant.value?.createdAt ?? '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
});
const initials = computed(() => {
  const parts = props.displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
});

const activeIndex = computed(() => {
  const id = props.message.activeVariantId;
  const index = props.message.variants.findIndex((v) => v.id === id);
  return index >= 0 ? index : 0;
});

function switchVariant(direction: -1 | 1): void {
  const variants = props.message.variants;
  if (variants.length < 2) return;
  const next = Math.min(variants.length - 1, Math.max(0, activeIndex.value + direction));
  const target = variants[next];
  if (target && target.id !== props.message.activeVariantId) emit('activate', target.id);
}

// -- Copy (raw Markdown source, plan §6.5.7) ----------------------------------
async function copyMessage(): Promise<void> {
  const text = activeVariant.value?.text ?? '';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    ui.notify('Copied', 'info');
  } catch {
    ui.notify('Could not copy the message', 'error');
  }
}

// -- Edit flows (D8) -----------------------------------------------------------
const editing = ref(false);
const draft = ref('');

function startEdit(): void {
  draft.value = activeVariant.value?.text ?? '';
  editing.value = true;
}
function cancelEdit(): void {
  editing.value = false;
}

function saveUserEdit(regenerateAfter: boolean): void {
  const text = draft.value.trim();
  if (text.length === 0) return;
  editing.value = false;
  emit('save', { text, regenerateAfter });
}

function saveAssistantEdit(): void {
  const text = draft.value.trim();
  if (text.length === 0) return;
  editing.value = false;
  emit('save', { text, regenerateAfter: false });
}

// -- Delete (D7: confirm every destructive action) ------------------------------
async function requestDelete(): Promise<void> {
  if (props.tone === 'user') {
    const { accepted, checked } = await ui.confirmWithCheckbox({
      title: 'Delete this message?',
      message: 'The message is removed from the chronicle.',
      confirmLabel: 'Delete message',
      danger: true,
      checkboxLabel: 'Also delete the reply that followed?',
      checkboxDefault: true,
    });
    if (accepted) emit('delete', checked);
    return;
  }
  const accepted = await ui.confirm({
    title: 'Delete this reply?',
    message:
      props.message.variants.length > 1
        ? 'All variants of this reply are removed. This cannot be undone.'
        : 'The reply is removed from the chronicle. This cannot be undone.',
    confirmLabel: 'Delete reply',
    danger: true,
  });
  if (accepted) emit('delete', false);
}
</script>

<template>
  <article
    class="group relative flex w-full flex-col gap-2 pt-1"
    :class="tone === 'character' ? 'border-b border-outline-variant/15 pb-4' : 'pb-2'"
  >
    <!-- Header line -->
    <div class="flex select-none items-center justify-between">
      <div class="flex min-w-0 items-center gap-2">
        <div
          v-if="tone === 'user'"
          class="flex size-5 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/20 text-[10px] font-bold text-primary"
        >
          {{ initials }}
        </div>
        <div v-else class="flex size-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container ring-1 ring-outline-variant/30">
          <img v-if="avatarPath" :src="avatarPath" :alt="displayName" class="size-full object-cover" />
          <span v-else class="text-[9px] font-bold text-secondary">{{ initials }}</span>
        </div>
        <span
          class="truncate text-[13px] font-semibold tracking-wide"
          :class="tone === 'user' ? 'text-[#f5ecd8]' : 'text-on-surface'"
        >{{ displayName }}</span>
        <span
          class="rounded px-1.5 py-0.5 text-[9.5px] font-medium"
          :class="tone === 'user'
            ? 'border border-amber-500/30 bg-amber-500/20 text-amber-200/90'
            : 'border border-outline-variant/30 bg-secondary-container/50 text-secondary'"
        >{{ tone === 'user' ? 'You' : 'Character' }}</span>
      </div>
      <div class="flex flex-shrink-0 items-center gap-1.5">
        <DeliveredDot
          v-if="justFinishedTone && !isStreaming"
          :tone="justFinishedTone"
        />
        <time
          class="text-[11px] tracking-wider"
          :class="justFinishedTone ? 'text-primary' : tone === 'user' ? 'text-amber-200/50' : 'text-outline'"
        >{{ timeLabel }}</time>
      </div>
    </div>

    <!-- Body -->
    <div class="relative pl-7" :class="tone === 'user' ? 'pr-4 text-on-surface' : ''">
      <span v-if="tone === 'user'" class="absolute bottom-0 right-0 top-0 w-[3px] rounded-full bg-[#F472B6]" aria-hidden="true" />
      <ErrorBubble
        v-if="message.isError && message.error"
        :error="message.error"
        :can-retry="!busy"
        @retry="emit('retry')"
        @delete="requestDelete()"
      />
      <template v-else>
        <textarea
          v-if="editing"
          :value="draft"
          rows="4"
          aria-label="Edit message text"
          class="w-full resize-none rounded-lg border border-primary/40 bg-surface-container-low p-2.5 font-serif text-[15px] leading-relaxed text-on-surface outline-none focus:border-primary/70"
          @input="draft = ($event.target as HTMLTextAreaElement).value"
          @keydown.escape.prevent="cancelEdit()"
          @keydown.enter.ctrl.exact.prevent="tone === 'user' ? saveUserEdit(false) : saveAssistantEdit()"
        />
        <template v-if="editing">
          <div v-if="tone === 'user'" class="mt-2 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[12px] text-secondary transition-colors hover:bg-surface-container-high hover:text-on-surface"
              @click="cancelEdit()"
            >Cancel</button>
            <button
              type="button"
              class="rounded-full border border-outline-variant/40 px-3 py-1.5 text-[12px] font-medium text-on-surface transition-colors hover:border-primary/50"
              @click="saveUserEdit(true)"
            >Save &amp; regenerate after</button>
            <button
              type="button"
              class="rounded-full bg-primary-container px-3 py-1.5 text-[12px] font-semibold text-on-primary-container transition active:scale-95"
              @click="saveUserEdit(false)"
            >Save</button>
          </div>
          <div v-else class="mt-2 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[12px] text-secondary transition-colors hover:bg-surface-container-high hover:text-on-surface"
              @click="cancelEdit()"
            >Cancel</button>
            <button
              type="button"
              class="rounded-full bg-primary-container px-3 py-1.5 text-[12px] font-semibold text-on-primary-container transition active:scale-95"
              @click="saveAssistantEdit()"
            >Save</button>
          </div>
        </template>
        <MessageBody
          v-if="!editing"
          :text="activeVariant?.text ?? ''"
          :streaming="isStreaming"
          :caret-blink-ms="caretBlinkMs"
        />
      </template>
    </div>

    <!-- Attachments -->
    <ImageGrid :attachments="message.attachments" />

    <!-- Actions row -->
    <div class="flex items-center justify-between pt-1 pl-7">
      <VariantSwitcher
        v-if="message.variants.length > 1 && !isStreaming"
        :index="activeIndex"
        :count="message.variants.length"
        @prev="switchVariant(-1)"
        @next="switchVariant(1)"
      />
      <span v-else />
      <MessageActions
        v-if="!isStreaming && !editing"
        :can-regenerate="canRegenerate && tone === 'character' && !message.isError"
        :can-edit="!message.isError"
        :can-retry="message.isError"
        :busy="busy"
        @regenerate="emit('regenerate')"
        @edit="startEdit()"
        @copy="copyMessage()"
        @delete="requestDelete()"
        @retry="emit('retry')"
      />
    </div>
  </article>
</template>
