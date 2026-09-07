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
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (accepted: boolean) => void;
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

  // -- Confirm dialog (D7: every destructive action confirms, no undo toasts) --
  const pendingConfirm = ref<PendingConfirm | null>(null);

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      pendingConfirm.value = { ...options, resolve };
    });
  }

  function settleConfirm(accepted: boolean): void {
    pendingConfirm.value?.resolve(accepted);
    pendingConfirm.value = null;
  }

  return { toasts, notify, dismiss, pendingConfirm, confirm, settleConfirm };
});
