<script setup lang="ts" vapor>
import { computed, ref, watch } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useOverlayA11y } from '@/utils/overlayA11y';

const ui = useUiStore();
const checked = ref(false);

// Re-seed per dialog (the component itself is not remounted between confirms).
watch(
  () => ui.pendingConfirm,
  (pending) => {
    checked.value = pending?.checkboxDefault ?? false;
  },
);

// M4 a11y: focus trap + Escape + focus restore, driven by the store state.
// (Vapor cannot bind template refs — the overlay is marked by data attribute.)
const { token } = useOverlayA11y(
  computed(() => ui.pendingConfirm !== null),
  {
    onEscape: () => ui.settleConfirm(false, checked.value),
  },
);

function toggleChecked(): void {
  checked.value = !checked.value;
}
</script>

<template>
  <div
    v-if="ui.pendingConfirm"
    :data-lk-overlay="token"
    class="fixed inset-0 z-60 flex items-center justify-center bg-surface-dim/70 px-6 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    :aria-label="ui.pendingConfirm.title"
    @click.self="ui.settleConfirm(false, checked)"
  >
    <div class="w-full max-w-sm rounded-xl border border-outline-variant/40 bg-surface-container p-5 shadow-2xl">
      <h2 class="text-[16px] font-semibold text-on-surface">{{ ui.pendingConfirm.title }}</h2>
      <p class="mt-2 font-serif text-[14px] leading-relaxed text-on-surface-variant">
        {{ ui.pendingConfirm.message }}
      </p>
      <button
        v-if="ui.pendingConfirm.checkboxLabel"
        type="button"
        role="checkbox"
        :aria-checked="checked"
        class="mt-3 flex w-full items-center gap-2 text-left text-[13px] text-on-surface"
        @click="toggleChecked"
      >
        <span
          class="flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
          :class="checked ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-low'"
        >
          <svg v-if="checked" viewBox="0 0 16 16" class="size-3 fill-none stroke-current stroke-2">
            <path d="M3 8.5 6.5 12 13 4.5" />
          </svg>
        </span>
        {{ ui.pendingConfirm.checkboxLabel }}
      </button>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-full px-4 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-surface-container-high hover:text-on-surface"
          @click="ui.settleConfirm(false, checked)"
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
          @click="ui.settleConfirm(true, checked)"
        >
          {{ ui.pendingConfirm.confirmLabel ?? 'Confirm' }}
        </button>
      </div>
    </div>
  </div>
</template>
