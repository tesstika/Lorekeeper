import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Optional checkbox (D7: "Also delete the reply that followed?"). */
  checkboxLabel?: string;
  checkboxDefault?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolveBoolean: ((accepted: boolean) => void) | null;
  resolveCheckbox: ((result: { accepted: boolean; checked: boolean }) => void) | null;
}

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  let nextId = 1;

  function notify(message: string, tone: ToastTone = 'info'): void {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, message, tone }];
    setTimeout(() => dismiss(id), 4200);
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  // -- Confirm dialog (D7) ----------------------------------------------------
  // D-F1 singleton safety: a new confirm while one is pending auto-cancels the
  // previous promise (never left dangling) and replaces the dialog.
  const pendingConfirm = ref<PendingConfirm | null>(null);

  function settleConfirm(accepted: boolean, checked: boolean): void {
    const pending = pendingConfirm.value;
    pendingConfirm.value = null;
    if (!pending) return;
    pending.resolveBoolean?.(accepted);
    pending.resolveCheckbox?.({ accepted, checked });
  }

  function confirm(options: ConfirmOptions): Promise<boolean> {
    settleConfirm(false, options.checkboxDefault ?? false);
    return new Promise((resolve) => {
      pendingConfirm.value = {
        ...options,
        resolveBoolean: resolve,
        resolveCheckbox: null,
      };
    });
  }

  function confirmWithCheckbox(
    options: ConfirmOptions,
  ): Promise<{ accepted: boolean; checked: boolean }> {
    settleConfirm(false, options.checkboxDefault ?? false);
    return new Promise((resolve) => {
      pendingConfirm.value = {
        ...options,
        resolveBoolean: null,
        resolveCheckbox: resolve,
      };
    });
  }

  return {
    toasts,
    notify,
    dismiss,
    pendingConfirm,
    confirm,
    confirmWithCheckbox,
    settleConfirm,
  };
});
