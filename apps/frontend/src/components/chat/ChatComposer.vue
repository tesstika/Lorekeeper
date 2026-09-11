<script setup lang="ts" vapor>
import { computed, ref } from 'vue';
import { useStreamingStore } from '@/stores/streaming';
import { useUiStore } from '@/stores/ui';

export interface PendingAttachment {
  id: string;
  url: string;
  originalName: string;
}

const props = withDefaults(
  defineProps<{
    enterToSend?: boolean;
    /** 'yes' | 'no' | 'unknown' — vision gating for the effective model (A1). */
    visionState?: 'yes' | 'no' | 'unknown';
    maxAttachments?: number;
  }>(),
  { enterToSend: true, visionState: 'unknown', maxAttachments: 4 },
);

const emit = defineEmits<{
  send: [payload: { text: string; attachmentIds: string[] }];
}>();

const ui = useUiStore();
const streaming = useStreamingStore();

const draft = ref('');
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const pending = ref<PendingAttachment[]>([]);
const MAX_ATTACHMENTS = computed(() => props.maxAttachments);
const MAX_HEIGHT_PX = 96; // max-h-24 (mockup)

const canSend = computed(
  () => !streaming.isStreaming && (draft.value.trim().length > 0 || pending.value.length > 0),
);

function autoGrow(): void {
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
}

function setDraft(value: string): void {
  draft.value = value;
  autoGrow();
}

async function attachFiles(files: ArrayLike<File>): Promise<void> {
  const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
  if (list.length === 0) return;
  if (props.visionState === 'no') {
    ui.notify(
      'The selected model does not support image input — remove the model override or pick a vision model.',
      'error',
    );
    return;
  }
  const room = MAX_ATTACHMENTS.value - pending.value.length;
  if (room <= 0) {
    ui.notify(`At most ${MAX_ATTACHMENTS.value} images per message.`, 'info');
    return;
  }
  const accepted = list.slice(0, room);
  if (accepted.length < list.length)
    ui.notify(`At most ${MAX_ATTACHMENTS.value} images per message.`, 'info');
  for (const file of accepted) {
    try {
      const { api } = await import('@/api');
      const uploaded = await api.uploadAttachment(file);
      pending.value = [
        ...pending.value,
        { id: uploaded.id, url: uploaded.url, originalName: uploaded.originalName },
      ];
    } catch (error) {
      ui.notify(error instanceof Error ? error.message : 'Upload failed', 'error');
    }
  }
}

function onPaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files;
  if (files && files.length > 0) {
    event.preventDefault();
    void attachFiles(files);
  }
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) void attachFiles(files);
}

function removeAttachment(id: string): void {
  pending.value = pending.value.filter((attachment) => attachment.id !== id);
}

function pickFiles(): void {
  if (props.visionState === 'no') {
    ui.notify('The selected model does not support image input.', 'error');
    return;
  }
  fileInputEl.value?.click();
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files) void attachFiles(input.files);
  input.value = '';
}

function submit(): void {
  if (!canSend.value) return;
  const text = draft.value.trim();
  if (text.length === 0 && pending.value.length > 0) {
    ui.notify('Add a few words to send with the image.', 'info');
    return;
  }
  emit('send', { text, attachmentIds: pending.value.map((attachment) => attachment.id) });
  draft.value = '';
  pending.value = [];
  const el = textareaEl.value;
  if (el) el.style.height = 'auto';
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  const enterPressed = !event.shiftKey;
  if (enterPressed && props.enterToSend) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <footer class="border-t border-outline-variant/30 bg-surface/90 px-4 pb-5 pt-2 backdrop-blur-md">
    <!-- Attachment tray + Stop -->
    <div v-if="pending.length > 0 || streaming.isStreaming" class="flex items-center justify-between px-1 pb-2">
      <div class="flex items-center gap-2">
        <div v-for="attachment in pending" :key="attachment.id" class="relative inline-flex items-center">
          <div class="size-12 shrink-0 overflow-hidden rounded-lg border border-amber-500/40 bg-surface-container shadow-md">
            <img :src="attachment.url" :alt="attachment.originalName" class="size-full object-cover" />
          </div>
          <button
            type="button"
            :aria-label="`Remove attached image ${attachment.originalName}`"
            class="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-outline-variant/40 bg-surface-container-highest text-on-surface shadow-sm transition active:scale-95 hover:bg-error hover:text-on-error"
            @click="removeAttachment(attachment.id)"
          >
            <svg viewBox="0 0 24 24" class="size-2.5 fill-none stroke-current stroke-2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      </div>
      <button
        v-if="streaming.isStreaming"
        type="button"
        aria-label="Stop generating"
        class="flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container-high px-2.5 py-1 text-[11px] text-secondary transition-colors active:scale-95 hover:text-error"
        @click="streaming.stop()"
      >
        <svg viewBox="0 0 24 24" class="size-3.5 fill-none stroke-tertiary stroke-2"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        Stop generating
      </button>
    </div>

    <p v-if="visionState === 'unknown' && pending.length > 0" class="px-1 pb-1.5 text-[11px] text-amber-200/80">
      This model's image support is unverified — the request may be rejected.
    </p>

    <!-- Composer shell -->
    <div
      class="flex items-end gap-1.5 rounded-xl border border-outline-variant/40 bg-surface-container p-1.5 shadow-lg transition-colors focus-within:border-primary/60"
      @dragover.prevent
      @drop="onDrop"
    >
      <button
        type="button"
        aria-label="Attach image"
        title="Attach image"
        class="flex size-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
        :class="visionState === 'no' ? 'cursor-not-allowed opacity-40' : ''"
        @click="pickFiles"
      >
        <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
      </button>
      <input
        ref="fileInputEl"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        class="hidden"
        aria-label="Choose images to attach"
        @change="onFilePicked"
      >
      <div
        class="min-w-0 flex-1 cursor-pointer py-1"
        @click="textareaEl?.focus()"
      >
        <textarea
          ref="textareaEl"
          rows="2"
          :value="draft"
          placeholder="Write your action or speak in &quot;quotes&quot;..."
          aria-label="Message text"
          class="max-h-24 w-full resize-none bg-transparent px-1 py-1 font-serif leading-relaxed text-on-surface outline-none placeholder:text-outline"
          @input="setDraft(($event.target as HTMLTextAreaElement).value)"
          @keydown="onKeydown"
          @paste="onPaste"
        />
      </div>
      <button
        type="button"
        aria-label="Send message"
        class="flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-tr from-amber-600 to-amber-400 font-bold text-[#1f1608] shadow-md transition active:scale-95 disabled:opacity-40"
        :disabled="!canSend"
        @click="submit()"
      >
        <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-[2.5]"><path d="m18 15-6-6-6 6" /></svg>
      </button>
    </div>
  </footer>
</template>
