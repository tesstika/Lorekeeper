<script setup lang="ts" vapor>
import { computed, watch } from 'vue';
import { useOllamaStore } from '@/stores/ollama';
import { formatBytes } from '@/utils/model-format';
import { useOverlayA11y } from '@/utils/overlayA11y';
import IconAlert from '~icons/lucide/circle-alert';
import IconDownload from '~icons/lucide/download';
import IconX from '~icons/lucide/x';

const props = defineProps<{ tag: string | null }>();
const emit = defineEmits<{ close: []; success: [] }>();

const ollama = useOllamaStore();

const pull = computed(() => (props.tag ? ollama.pullState(props.tag) : null));

const percent = computed(() => {
  const state = pull.value;
  if (!state || state.completed === null || state.total === null || state.total <= 0) return 0;
  return Math.min(100, Math.round((state.completed / state.total) * 100));
});

const failed = computed(() => pull.value?.error != null);
const succeeded = computed(() => pull.value?.success === true);

// Healthy completion auto-advances the chat flow (the parent retries the
// generation); cancellation and errors stay open with a Close affordance.
watch(succeeded, (done) => {
  if (done) emit('success');
});

// (Vapor cannot bind template refs — the overlay is marked by data attribute.)
const { token } = useOverlayA11y(() => props.tag !== null, { onEscape: () => emit('close') });

function cancelPull(): void {
  if (props.tag) ollama.cancelPull(props.tag);
}
</script>

<template>
  <div
    v-if="tag"
    :data-lk-overlay="token"
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Model download progress"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-sm space-y-4 rounded-t-xl border border-outline-variant/40 bg-surface-container-low p-5 sm:rounded-xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-highest text-primary-container">
            <IconDownload class="size-5" :class="{ 'animate-pulse': pull?.active }" />
          </div>
          <div>
            <h3 class="text-[15px] font-semibold leading-5 text-on-surface">Model download</h3>
            <p class="text-[11px] leading-3.5 text-secondary">
              {{ pull?.active ? 'Downloading via Ollama…' : failed ? 'Download failed' : succeeded ? 'Download complete' : 'Download paused' }}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="rounded p-1.5 text-on-surface-variant transition-colors hover:text-error"
          aria-label="Close download progress"
          @click="emit('close')"
        >
          <IconX class="size-5" />
        </button>
      </div>

      <p class="font-mono text-[11px] leading-4 break-all text-outline">{{ tag }}</p>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2 text-[12px] leading-4">
          <span class="flex items-center gap-1.5 truncate" :class="failed ? 'text-error' : 'text-on-surface-variant'">
            <IconAlert v-if="failed" class="size-3.5 shrink-0 text-error" />
            {{ pull?.status ?? '…' }}
          </span>
          <span class="shrink-0 font-mono text-primary">{{ percent }}%</span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            class="h-full rounded-full"
            :class="failed ? 'bg-error' : 'bg-primary'"
            :style="{ width: `${percent}%` }"
          ></div>
        </div>
        <div class="flex items-center justify-between font-mono text-[11px] text-outline">
          <span>{{ formatBytes(pull?.completed ?? null) ?? '0 B' }} downloaded</span>
          <span>{{ formatBytes(pull?.total ?? null) ?? '—' }} total</span>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button
          v-if="pull?.active"
          type="button"
          class="rounded-md border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-[12px] font-medium text-on-surface-variant transition-colors hover:text-error"
          aria-label="Cancel model download"
          @click="cancelPull()"
        >
          Cancel download
        </button>
        <button
          v-else
          type="button"
          class="rounded-md border border-outline-variant/40 bg-surface-container px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface-container-high"
          aria-label="Close"
          @click="emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
