import type {
  OllamaCuratedModel,
  OllamaModelStateResponse,
  OllamaStatusResponse,
} from '@lorekeeper/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api';
import { streamOllamaPull } from '@/api/sse';
import { describeApiError } from '@/utils/errors';

export interface OllamaPullState {
  status: string;
  completed: number | null;
  total: number | null;
  error: string | null;
  active: boolean;
  /** True only when the stream ended with a healthy completion (not cancelled). */
  success: boolean;
}

/**
 * Front-end owner of the Ollama daemon state (feature spec §2): live status
 * for the Settings banner, the curated catalog with download states, and the
 * per-tag pull progress consumed from the SSE pull stream.
 */
export const useOllamaStore = defineStore('ollama', () => {
  const status = ref<OllamaStatusResponse | null>(null);
  const models = ref<OllamaCuratedModel[] | null>(null);
  const statusLoading = ref(false);
  const modelsLoading = ref(false);
  const pulls = ref<Record<string, OllamaPullState>>({});
  /** Pull state of ad-hoc tags (e.g. the image-captioning vision model). */
  const modelStates = ref<Record<string, OllamaModelStateResponse>>({});
  const controllers = new Map<string, AbortController>();

  const offline = computed(() => status.value !== null && !status.value.running);

  function pullState(modelTag: string): OllamaPullState | null {
    return pulls.value[modelTag] ?? null;
  }

  /** Live daemon probe (Settings "Check Connection" + chat gating). */
  async function checkStatus(): Promise<OllamaStatusResponse> {
    statusLoading.value = true;
    try {
      status.value = await api.getOllamaStatus();
      return status.value;
    } finally {
      statusLoading.value = false;
    }
  }

  /** Curated catalog with Downloaded / Not Downloaded states + byte sizes. */
  async function fetchModels(): Promise<void> {
    modelsLoading.value = true;
    try {
      models.value = (await api.getOllamaModels()).models;
    } finally {
      modelsLoading.value = false;
    }
  }

  /** Pull state of a single ad-hoc tag (not on the curated whitelist). */
  async function checkModelState(modelTag: string): Promise<OllamaModelStateResponse> {
    const state = await api.getOllamaModelState(modelTag);
    modelStates.value = { ...modelStates.value, [modelTag]: state };
    return state;
  }

  function modelState(modelTag: string): OllamaModelStateResponse | null {
    return modelStates.value[modelTag] ?? null;
  }

  /** Streams a pull; resolves when the stream ends (success, error or cancel). */
  async function startPull(modelTag: string): Promise<void> {
    if (pulls.value[modelTag]?.active) return;
    pulls.value[modelTag] = {
      status: 'Preparing download…',
      completed: null,
      total: null,
      error: null,
      active: true,
      success: false,
    };
    const controller = new AbortController();
    controllers.set(modelTag, controller);
    try {
      await streamOllamaPull(
        modelTag,
        {
          onProgress: (event) => {
            const state = pulls.value[modelTag];
            if (!state) return;
            if (event.error) {
              state.error = event.error;
              state.status = event.error;
            } else {
              state.status = event.status;
            }
            if (event.completed != null) state.completed = event.completed;
            if (event.total != null) state.total = event.total;
          },
        },
        controller.signal,
      );
      const state = pulls.value[modelTag];
      if (state && !state.error && !controller.signal.aborted) {
        state.status = 'Downloaded';
        state.completed = state.total;
        state.success = true;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = describeApiError(error);
      const state = pulls.value[modelTag];
      if (state) {
        state.error = state.error ?? message;
        state.status = state.error;
      }
      throw error;
    } finally {
      controllers.delete(modelTag);
      const state = pulls.value[modelTag];
      if (state && controller.signal.aborted) state.status = 'Download cancelled';
      if (state) state.active = false;
      void fetchModels().catch(() => {});
    }
  }

  function cancelPull(modelTag: string): void {
    controllers.get(modelTag)?.abort();
  }

  return {
    status,
    models,
    statusLoading,
    modelsLoading,
    pulls,
    modelStates,
    offline,
    pullState,
    modelState,
    checkStatus,
    fetchModels,
    checkModelState,
    startPull,
    cancelPull,
  };
});
