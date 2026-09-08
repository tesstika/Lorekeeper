<script setup lang="ts" vapor>
import type { ChatErrorData } from '@lorekeeper/shared';
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{ error: ChatErrorData; canRetry?: boolean }>();
const emit = defineEmits<{ retry: []; delete: [] }>();

const ERROR_TITLES: Record<string, string> = {
  rate_limited: 'Rate limited',
  insufficient_credits: 'Insufficient credits',
  invalid_key: 'Invalid API key',
  no_key: 'Missing API key',
  network_error: 'Connection failed',
  malformed_response: 'Malformed response',
  upstream_error: 'Provider error',
  provider_error: 'Provider error',
  idle_timeout: 'Provider stalled',
  no_model_configured: 'No model configured',
  aborted: 'Stopped',
};

const title = computed(() => ERROR_TITLES[props.error.code] ?? 'Generation failed');
const detailsOpen = ref(false);

const countdownMs = ref(props.error.retryAfterMs ?? 0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;
if ((props.error.retryAfterMs ?? 0) > 0) {
  countdownTimer = setInterval(() => {
    countdownMs.value = Math.max(0, countdownMs.value - 250);
    if (countdownMs.value === 0 && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 250);
}
onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});

const retryLabel = computed(() => {
  if (countdownMs.value > 0) return `Retry in ${Math.ceil(countdownMs.value / 1000)}s`;
  return 'Retry';
});
const retryDisabled = computed(() => countdownMs.value > 0);
</script>

<template>
  <div
    class="rounded-lg border-l-2 border-error bg-error-container/30 px-3 py-2.5"
    role="alert"
  >
    <div class="flex items-center gap-2">
      <svg viewBox="0 0 24 24" class="size-4 flex-shrink-0 fill-none stroke-error stroke-2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v5" />
        <path d="M12 16.5v.01" />
      </svg>
      <p class="text-[13px] font-semibold text-error">{{ title }}</p>
      <button
        type="button"
        aria-label="Toggle error details"
        class="ml-auto text-[11px] text-secondary underline-offset-2 transition-colors hover:text-on-surface hover:underline"
        @click="detailsOpen = !detailsOpen"
      >
        {{ detailsOpen ? 'Hide details' : 'Details' }}
      </button>
    </div>
    <div v-if="detailsOpen" class="mt-2 rounded bg-surface-container-lowest/60 px-2.5 py-2">
      <p class="break-words font-mono text-[11px] leading-relaxed text-on-surface-variant">
        {{ error.message }}
      </p>
      <p v-if="error.statusCode !== undefined || error.retryAfterMs !== undefined" class="mt-1 font-mono text-[10px] text-outline">
        <span v-if="error.statusCode !== undefined">HTTP {{ error.statusCode }}</span>
        <span v-if="error.statusCode !== undefined && error.retryAfterMs !== undefined"> · </span>
        <span v-if="error.retryAfterMs !== undefined">retry after {{ error.retryAfterMs }}ms</span>
      </p>
    </div>
    <div v-if="canRetry" class="mt-2.5 flex items-center gap-2">
      <button
        type="button"
        aria-label="Retry reply"
        class="flex items-center gap-1 rounded-full border border-error/40 px-3 py-1 text-[12px] font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="retryDisabled"
        @click="emit('retry')"
      >
        <svg viewBox="0 0 24 24" class="size-3.5 fill-none stroke-current stroke-2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {{ retryLabel }}
      </button>
      <button
        type="button"
        aria-label="Delete message"
        class="rounded-full px-3 py-1 text-[12px] text-secondary transition-colors hover:bg-surface-container-high hover:text-error"
        @click="emit('delete')"
      >
        Delete
      </button>
    </div>
  </div>
</template>
