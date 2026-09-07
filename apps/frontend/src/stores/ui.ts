import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
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

  return { toasts, notify, dismiss };
});
