import type { ModelInfo, OllamaStatusResponse, ProviderInfo } from '@lorekeeper/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, vaporInteropPlugin } from 'vue';
import OllamaDownloadModal from '../components/ollama/OllamaDownloadModal.vue';
import EngineCard from '../components/settings/EngineCard.vue';
import ProviderKeysCard from '../components/settings/ProviderKeysCard.vue';
import { type OllamaPullState, useOllamaStore } from '../stores/ollama';
import { useSettingsStore } from '../stores/settings';

const MISTRAL_TAG =
  'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M';
const CYDONIA_TAG = 'hf.co/jwhisenhunt/Cydonia-24B-v4.3-absolute-heresy-Q4_K_M-GGUF';
const ROCINANTE_TAG = 'hf.co/BeaverAI/Rocinante-XL-16B-v1b-GGUF:Q4_K_M';
const CURATED_TAGS = [MISTRAL_TAG, CYDONIA_TAG, ROCINANTE_TAG];
const MISTRAL_LABEL = 'Mistral Small 3.2 24B Abliterated (Q4_K_M)';
const CYDONIA_LABEL = 'Cydonia 24B v4.3-Heresy (Q4_K_M)';
const ROCINANTE_LABEL = 'Rocinante XL 16B v1b (Q4_K_M)';
const CURATED_LABELS = [MISTRAL_LABEL, CYDONIA_LABEL, ROCINANTE_LABEL];

const catalogModels: ModelInfo[] = CURATED_TAGS.map((id, index) => ({
  id,
  name: CURATED_LABELS[index] ?? id,
  contextLength: null,
  inputModalities: [],
}));

const providersFixture: ProviderInfo[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hasKey: true,
    keyHint: 'sk-or-…3456',
    status: 'connected',
    latencyMs: null,
    modelsFetchedAt: null,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    hasKey: true,
    keyHint: null,
    status: 'connected',
    latencyMs: null,
    modelsFetchedAt: null,
  },
];

const apiState = vi.hoisted(() => {
  return {
    ollamaStatus: { running: false, version: null } as OllamaStatusResponse,
    ollamaModels: [] as Array<{
      tag: string;
      label: string;
      huggingFaceUrl: string;
      downloaded: boolean;
      sizeBytes: number | null;
    }>,
    pulledTags: [] as string[],
    clone: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
  };
});

vi.mock('@/api', () => ({
  ApiError: class ApiError extends Error {
    code = 'http_error';
  },
  api: {
    getSettings: async () => ({
      globalDefaults: {
        providerId: 'ollama',
        modelId: null,
        presetId: null,
        personaId: null,
        contextBudgetTokens: 8192,
        keepLastNVariants: 20,
      },
      promptTemplate: { systemTemplate: 'S', postHistoryInstructions: '' },
      composer: {
        enterToSend: true,
        autoScroll: true,
        imageMaxBytes: 8_000_000,
        editDefaultRegenerate: false,
        caretBlinkMs: 500,
        deliveredBlinkMs: 250,
        deliveredBlinks: 6,
      },
    }),
    patchSettings: async () => {
      throw new Error('not used in this suite');
    },
    getProviders: async () => apiState.clone(providersFixture),
    getPresets: async () => [],
    getProviderModels: async () => ({
      models: apiState.clone(catalogModels),
      fetchedAt: '2026-09-12T00:00:00.000Z',
      cached: false,
    }),
    getOllamaStatus: async () => apiState.clone(apiState.ollamaStatus),
    getOllamaModels: async () => ({
      running: apiState.ollamaStatus.running,
      models: apiState.clone(apiState.ollamaModels),
    }),
  },
}));

vi.mock('@/api/sse', () => ({
  streamGeneration: async () => {},
  streamOllamaPull: async (
    modelTag: string,
    handlers: { onProgress: (event: Record<string, unknown>) => void },
  ) => {
    apiState.pulledTags.push(modelTag);
    handlers.onProgress({ modelTag, status: 'downloading', completed: 500, total: 1000 });
    handlers.onProgress({ modelTag, status: 'success', completed: 1000, total: 1000 });
  },
}));

function host(
  template: string,
  components: Record<string, object>,
): ReturnType<typeof defineComponent> {
  return defineComponent({ components, template });
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiState.ollamaStatus = { running: false, version: null };
  apiState.ollamaModels = CURATED_TAGS.map((tag, index) => ({
    tag,
    label: CURATED_LABELS[index] ?? tag,
    huggingFaceUrl: `https://huggingface.co/${tag}`,
    downloaded: index === 0,
    sizeBytes: index === 0 ? 14_111_222_333 : null,
  }));
  apiState.pulledTags = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderKeysCard — Ollama card', () => {
  it('renders the offline banner with the friendly message, link and retry', async () => {
    const Host = host('<div><ProviderKeysCard :providers="providers" /></div>', {
      ProviderKeysCard,
    });
    const wrapper = mount(Host, {
      data: () => ({ providers: providersFixture }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Ollama is not running. Please install or start Ollama on your computer.',
    );
    const link = wrapper.find('a[href="https://ollama.com"]');
    expect(link.exists()).toBe(true);
    expect(wrapper.text()).toContain('Check Connection');
    // The Ollama card swaps the key row for daemon status — no key input.
    expect(wrapper.find('input[aria-label="Ollama API key"]').exists()).toBe(false);
    expect(wrapper.find('input[aria-label="OpenRouter API key"]').exists()).toBe(true);
  });

  it('Check Connection retries and flips the banner to the running state', async () => {
    const Host = host('<div><ProviderKeysCard :providers="providers" /></div>', {
      ProviderKeysCard,
    });
    const wrapper = mount(Host, {
      data: () => ({ providers: providersFixture }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Not running');

    apiState.ollamaStatus = { running: true, version: '0.12.6' };
    await wrapper.find('button[aria-label="Check Ollama connection"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Running (v0.12.6)');
    expect(wrapper.text()).not.toContain(
      'Ollama is not running. Please install or start Ollama on your computer.',
    );
  });

  it('shows the running daemon state without a banner when online', async () => {
    apiState.ollamaStatus = { running: true, version: '0.12.6' };
    const Host = host('<div><ProviderKeysCard :providers="providers" /></div>', {
      ProviderKeysCard,
    });
    const wrapper = mount(Host, {
      data: () => ({ providers: providersFixture }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Running (v0.12.6)');
    expect(wrapper.text()).toContain('no API key needed');
  });
});

describe('EngineCard — Ollama model library', () => {
  it('lists curated models with download states and a working Download button', async () => {
    const store = useSettingsStore();
    await store.load();
    const Host = host('<div><EngineCard /></div>', { EngineCard });
    const wrapper = mount(Host, {
      global: { plugins: [vaporInteropPlugin] },
    });
    await flushPromises();

    await wrapper.find('button[aria-label="Open model library"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(MISTRAL_LABEL);
    expect(wrapper.text()).toContain('Downloaded');
    // 14_111_222_333 bytes → binary GB display.
    expect(wrapper.text()).toContain('13.1 GB');

    const downloadButton = wrapper.find(`button[aria-label="Download ${CYDONIA_LABEL}"]`);
    expect(downloadButton.exists()).toBe(true);
    await downloadButton.trigger('click');
    await flushPromises();

    expect(apiState.pulledTags).toEqual([CYDONIA_TAG]);
    // After the successful pull the row flips to the Downloaded chip.
    expect(wrapper.find(`button[aria-label="Download ${CYDONIA_LABEL}"]`).exists()).toBe(false);
    const cydoniaRow = wrapper.findAll('div').find((node) => node.text().includes(CYDONIA_LABEL));
    expect(cydoniaRow?.text()).toContain('Downloaded');
  });
});

describe('OllamaDownloadModal', () => {
  it('renders live progress (percent + bytes) and emits success on completion', async () => {
    const ollama = useOllamaStore();
    const pull: OllamaPullState = {
      status: 'downloading sha256:abc',
      completed: 400,
      total: 1000,
      error: null,
      active: true,
      success: false,
    };
    ollama.pulls[CYDONIA_TAG] = pull;

    const Host = host('<div><OllamaDownloadModal :tag="tag" @success="done = true" /></div>', {
      OllamaDownloadModal,
    });
    const wrapper = mount(Host, {
      data: () => ({ tag: null as string | null, done: false }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

    (wrapper.vm as unknown as { tag: string | null }).tag = CYDONIA_TAG;
    await nextTick();
    await flushPromises();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('40%');
    expect(wrapper.text()).toContain('400 B downloaded');
    expect(wrapper.text()).toContain('1000 B total');
    expect(wrapper.text()).toContain('Cancel download');

    // Mutate through the store's reactive handle (the raw object would bypass
    // the proxy and never trigger the modal's watcher).
    const state = ollama.pullState(CYDONIA_TAG);
    if (state) state.success = true;
    await nextTick();
    await flushPromises();
    expect((wrapper.vm as unknown as { done: boolean }).done).toBe(true);
  });

  it('renders the failure state with a Close affordance and no success event', async () => {
    const ollama = useOllamaStore();
    ollama.pulls[CYDONIA_TAG] = {
      status: 'pull model manifest: file does not exist',
      completed: null,
      total: null,
      error: 'pull model manifest: file does not exist',
      active: false,
      success: false,
    };
    const Host = host('<div><OllamaDownloadModal :tag="tag" @success="done = true" /></div>', {
      OllamaDownloadModal,
    });
    const wrapper = mount(Host, {
      data: () => ({ tag: CYDONIA_TAG as string | null, done: false }),
      global: { plugins: [vaporInteropPlugin] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Download failed');
    expect(wrapper.text()).toContain('pull model manifest: file does not exist');
    expect(wrapper.text()).toContain('Close');
    expect((wrapper.vm as unknown as { done: boolean }).done).toBe(false);
  });
});
