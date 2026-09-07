<script setup lang="ts" vapor>
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();
</script>

<template>
  <div
    v-if="ui.pendingConfirm"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-surface-dim/70 px-6 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    :aria-label="ui.pendingConfirm.title"
    @click.self="ui.settleConfirm(false)"
  >
    <div class="w-full max-w-sm rounded-xl border border-outline-variant/40 bg-surface-container p-5 shadow-2xl">
      <h2 class="text-[16px] font-semibold text-on-surface">{{ ui.pendingConfirm.title }}</h2>
      <p class="mt-2 font-serif text-[14px] leading-relaxed text-on-surface-variant">
        {{ ui.pendingConfirm.message }}
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-full px-4 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-surface-container-high hover:text-on-surface"
          @click="ui.settleConfirm(false)"
        >
          {{ ui.pendingConfirm.cancelLabel ?? 'Cancel' }}
        </button>
        <button
          type="button"
          class="rounded-full px-4 py-2 text-[13px] font-semibold shadow transition active:scale-95"
          :class="
            ui.pendingConfirm.danger
              ? 'bg-error-container text-on-error hover:bg-error/90'
              : 'bg-primary-container text-on-primary-container'
          "
          @click="ui.settleConfirm(true)"
        >
          {{ ui.pendingConfirm.confirmLabel ?? 'Confirm' }}
        </button>
      </div>
    </div>
  </div>
</template>
