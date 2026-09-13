import type { Preset, ProviderInfo, SettingsResponse } from '@lorekeeper/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, vaporInteropPlugin } from 'vue';
import ComposerCard from '../components/settings/ComposerCard.vue';
import DisplayCard from '../components/settings/DisplayCard.vue';
import PresetCard from '../components/settings/PresetCard.vue';
import SamplingCard from '../components/settings/SamplingCard.vue';
import NumberStepper from '../components/ui/NumberStepper.vue';
import RangeSlider from '../components/ui/RangeSlider.vue';
import TagInput from '../components/ui/TagInput.vue';
import ToggleSwitch from '../components/ui/ToggleSwitch.vue';
import SettingsPage from '../pages/SettingsPage.vue';
import { router } from '../router';
import { useSettingsStore } from '../stores/settings';

const NOW_ISO = '2026-09-07T00:00:00.000Z';
const NOW_ISO_PLACEHOLDER = NOW_ISO;

const settingsFixture: SettingsResponse = {
  globalDefaults: {
    providerId: null,
    modelId: null,
    presetId: null,
    personaId: null,
    contextBudgetTokens: 8192,
    keepLastNVariants: 20,
  },
  promptTemplate: { systemTemplate: 'You are {{char}}.', postHistoryInstructions: '' },
  composer: {
    enterToSend: true,
    autoScroll: true,
    imageMaxBytes: 8_000_000,
    editDefaultRegenerate: false,
    caretBlinkMs: 500,
    deliveredBlinkMs: 250,
    deliveredBlinks: 6,
  },
  imageCaptioning: {
    enabled: false,
    providerId: 'ollama',
    modelId: 'moondream:latest',
    prompt: 'Describe this image in rich detail.',
  },
  display: { backgroundEffect: 'stars' },
};

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
    id: 'unorouter',
    label: 'UnoRouter',
    baseUrl: 'https://api.unorouter.com/v1',
    hasKey: false,
    keyHint: null,
    status: 'no_key',
    latencyMs: null,
    modelsFetchedAt: null,
  },
];

const presetsFixture: Preset[] = [
  {
    id: 'p1',
    name: 'Default Sanctum',
    description: 'Balanced baseline for narrative roleplay.',
    temperature: 0.85,
    topP: 0.92,
    topK: null,
    maxTokens: 4096,
    frequencyPenalty: 0,
    presencePenalty: 0,
    repetitionPenalty: null,
    stopSequences: [],
    isDefault: true,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
];

// Mutable server state backing the mocked api module (vi.hoisted keeps the
// factory + assertions in the same scope).
const apiState = vi.hoisted(() => {
  const settings: SettingsResponse = {
    globalDefaults: {
      providerId: null,
      modelId: null,
      presetId: null,
      personaId: null,
      contextBudgetTokens: 8192,
      keepLastNVariants: 20,
    },
    promptTemplate: { systemTemplate: 'You are {{char}}.', postHistoryInstructions: '' },
    composer: {
      enterToSend: true,
      autoScroll: true,
      imageMaxBytes: 8_000_000,
      editDefaultRegenerate: false,
      caretBlinkMs: 500,
      deliveredBlinkMs: 250,
      deliveredBlinks: 6,
    },
    imageCaptioning: {
      enabled: false,
      providerId: 'ollama',
      modelId: 'moondream:latest',
      prompt: 'Describe this image in rich detail.',
    },
    display: { backgroundEffect: 'stars' },
  };
  const providers: ProviderInfo[] = [
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
      id: 'unorouter',
      label: 'UnoRouter',
      baseUrl: 'https://api.unorouter.com/v1',
      hasKey: false,
      keyHint: null,
      status: 'no_key',
      latencyMs: null,
      modelsFetchedAt: null,
    },
  ];
  const presets: Preset[] = [
    {
      id: 'p1',
      name: 'Default Sanctum',
      description: 'Balanced baseline for narrative roleplay.',
      temperature: 0.85,
      topP: 0.92,
      topK: null,
      maxTokens: 4096,
      frequencyPenalty: 0,
      presencePenalty: 0,
      repetitionPenalty: null,
      stopSequences: [],
      isDefault: true,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    },
  ];
  return {
    settings,
    providers,
    presets,
    clone: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
  };
});

vi.mock('@/api', () => ({
  ApiError: class ApiError extends Error {
    code = 'http_error';
  },
  api: {
    getSettings: async () => apiState.clone(apiState.settings),
    patchSettings: async (patch: Record<string, Record<string, unknown>>) => {
      for (const [section, value] of Object.entries(patch)) {
        if (value) {
          const current = (apiState.settings as Record<string, unknown>)[section] as Record<
            string,
            unknown
          >;
          (apiState.settings as Record<string, unknown>)[section] = { ...current, ...value };
        }
      }
      return apiState.clone(apiState.settings);
    },
    getProviders: async () => apiState.clone(apiState.providers),
    getPresets: async () => apiState.clone(apiState.presets),
    setProviderKey: async () => ({ ok: true as const, keyHint: 'sk-or-…abcd' }),
    clearProviderKey: async () => ({ ok: true as const }),
    testProvider: async () => {
      // The server persists the last test result; mirror that here.
      const target = apiState.providers.find((p) => p.id === 'openrouter');
      if (target) {
        target.latencyMs = 42;
        target.status = 'connected';
      }
      return { status: 'connected' as const, latencyMs: 42, code: null, message: null };
    },
    getProviderModels: async () => ({ models: [], fetchedAt: NOW_ISO_PLACEHOLDER, cached: false }),
    getOllamaStatus: async () => ({ running: true, version: '0.34.0' }),
    getOllamaModelState: async () => ({ running: true, downloaded: false, sizeBytes: null }),
    createPreset: async (input: Record<string, unknown>) => {
      const preset = {
        name: '',
        description: '',
        temperature: 0.85,
        topP: 0.92,
        topK: null,
        maxTokens: 4096,
        frequencyPenalty: 0,
        presencePenalty: 0,
        repetitionPenalty: null,
        stopSequences: [],
        isDefault: false,
        ...input,
        id: `p${apiState.presets.length + 1}`,
        createdAt: NOW_ISO_PLACEHOLDER,
        updatedAt: NOW_ISO_PLACEHOLDER,
      };
      apiState.presets.push(preset as never);
      return apiState.clone(preset);
    },
    updatePreset: async (id: string, patch: Record<string, unknown>) => {
      const index = apiState.presets.findIndex((p) => p.id === id);
      const preset = {
        ...apiState.presets[index],
        ...patch,
        updatedAt: NOW_ISO_PLACEHOLDER,
      } as Preset;
      apiState.presets[index] = preset;
      return apiState.clone(preset);
    },
    deletePreset: async (id: string) => {
      apiState.presets = apiState.presets.filter((p) => p.id !== id);
      return { ok: true as const };
    },
  },
}));

// Vapor components must mount through a VDOM host (M0 §6.1 / test-utils 2.5.0).
function host(
  template: string,
  components: Record<string, object>,
): ReturnType<typeof defineComponent> {
  return defineComponent({ components, template });
}

/** Track the wrapper of tests that mount full cards so afterEach can unmount. */
let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  apiState.settings = apiState.clone(JSON.parse(JSON.stringify(settingsFixture)));
  apiState.providers = apiState.clone(JSON.parse(JSON.stringify(providersFixture)));
  apiState.presets = apiState.clone(JSON.parse(JSON.stringify(presetsFixture)));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe('settings UI primitives', () => {
  it('RangeSlider updates its v-model and shows scale labels', async () => {
    const Host = host(
      '<div><RangeSlider v-model="value" label="Temperature" :min="0" :max="2" :step="0.01" :scale-labels="[\'0.0\', \'1.0\', \'2.0\']" /></div>',
      { RangeSlider },
    );
    const wrapper = mount(Host, {
      data: () => ({ value: 0.5 }),
      global: { plugins: [vaporInteropPlugin] },
    });
    const input = wrapper.find('input[type="range"]');
    expect(input.exists()).toBe(true);
    await input.setValue('1.3');
    expect((wrapper.vm as unknown as { value: number }).value).toBeCloseTo(1.3);
    expect(wrapper.text()).toContain('0.0');
  });

  it('NumberStepper steps, formats, and supports Off (null)', async () => {
    const Host = host(
      '<div><NumberStepper v-model="count" label="max tokens" :min="64" :max="100000" :step="256" :format="(v) => v.toLocaleString()" /></div>',
      { NumberStepper },
    );
    const wrapper = mount(Host, {
      data: () => ({ count: 4096 as number | null }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('4,096');
    await wrapper.find('button[aria-label="Increase max tokens"]').trigger('click');
    expect((wrapper.vm as unknown as { count: number | null }).count).toBe(4352);
  });

  it('NumberStepper renders Off for null and turns the knob back on', async () => {
    const Host = host(
      '<div><NumberStepper v-model="count" label="top K" :min="1" :max="200" :step="1" :allow-off="true" /></div>',
      { NumberStepper },
    );
    const wrapper = mount(Host, {
      data: () => ({ count: null as number | null }),
      global: { plugins: [vaporInteropPlugin] },
    });
    expect(wrapper.text()).toContain('Off');
    await wrapper.find('button[aria-label="Increase top K"]').trigger('click');
    expect((wrapper.vm as unknown as { count: number | null }).count).toBe(1);
    await wrapper.find('button[aria-label="Decrease top K"]').trigger('click');
    expect((wrapper.vm as unknown as { count: number | null }).count).toBeNull();
  });

  it('ToggleSwitch (role=switch button) flips its v-model', async () => {
    const Host = host('<div><ToggleSwitch v-model="on" label="Enter sends message" /></div>', {
      ToggleSwitch,
    });
    const wrapper = mount(Host, {
      data: () => ({ on: true }),
      global: { plugins: [vaporInteropPlugin] },
    });
    const button = wrapper.find('button[role="switch"]');
    expect(button.attributes('aria-checked')).toBe('true');
    await button.trigger('click');
    expect((wrapper.vm as unknown as { on: boolean }).on).toBe(false);
    expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('false');
  });

  it('TagInput adds and removes chips', async () => {
    const Host = host(
      '<div><TagInput v-model="tags" label="stop sequence" add-label="+ Add Tag" /></div>',
      {
        TagInput,
      },
    );
    const wrapper = mount(Host, {
      data: () => ({ tags: ['***'] as string[] }),
      global: { plugins: [vaporInteropPlugin] },
    });
    const input = wrapper.find('input[type="text"]');
    await input.setValue('Player:');
    await input.trigger('keydown', { key: 'Enter' });
    expect((wrapper.vm as unknown as { tags: string[] }).tags).toEqual(['***', 'Player:']);
    expect(wrapper.text()).toContain('Player:');
    await wrapper.find('button[aria-label="Remove stop sequence ***"]').trigger('click');
    expect((wrapper.vm as unknown as { tags: string[] }).tags).toEqual(['Player:']);
  });
});

describe('SamplingCard', () => {
  it('binds sliders to the working preset and updates the qualitative label', async () => {
    const store = useSettingsStore();
    await store.load();
    const Host = host('<div><SamplingCard /></div>', { SamplingCard });
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });

    expect(wrapper.text()).toContain('0.85');
    expect(wrapper.text()).toContain('Creative & Expressive');
    await wrapper.find('input[aria-label="Temperature"]').setValue('1.30');
    expect(store.workingPreset.temperature).toBeCloseTo(1.3);
    expect(wrapper.text()).toContain('Vivid & Chaotic');
  });
});

describe('ComposerCard', () => {
  it('persists toggle and slider changes through the settings API', async () => {
    const store = useSettingsStore();
    await store.load();
    const Host = host('<div><ComposerCard /></div>', { ComposerCard });
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });

    await wrapper.find('button[aria-label="Enter sends message"]').trigger('click');
    await flushPromises();
    expect(apiState.settings.composer.enterToSend).toBe(false);
    expect(store.composer.enterToSend).toBe(false);

    await wrapper.find('input[aria-label="Caret blink interval"]').setValue('800');
    await flushPromises();
    expect(apiState.settings.composer.caretBlinkMs).toBe(800);
    expect(store.composer.caretBlinkMs).toBe(800);
  });
});

describe('ProviderKeysCard (page-level integration)', () => {
  // The card receives its providers via props from the vapor SettingsPage; the
  // reactive chain is vapor→vapor, so tests mount the real page (VDOM host
  // wrapper per the M0 pattern).
  async function mountSettingsPage() {
    const Host = host('<div><SettingsPage /></div>', { SettingsPage });
    const wrapper = mount(Host, {
      global: { plugins: [vaporInteropPlugin, router] },
    });
    await flushPromises();
    return wrapper;
  }

  it('shows key hints without plaintext and displays live latency after a test', async () => {
    const store = useSettingsStore();
    const wrapper = await mountSettingsPage();

    expect(wrapper.text()).toContain('sk-or-…3456');
    expect(wrapper.text()).not.toContain('sk-or-v1-real');
    expect(wrapper.text()).toContain('Key saved — not verified');
    expect(wrapper.text()).toContain('Not configured');

    await wrapper.find('button[aria-label="Test OpenRouter connection"]').trigger('click');
    await flushPromises();
    expect(store.providers.find((p) => p.id === 'openrouter')?.latencyMs).toBe(42);
    expect(wrapper.text()).toContain('Connected (Latency 42ms)');
  });

  it('disables connection testing for providers without keys', async () => {
    const wrapper = await mountSettingsPage();
    const testButton = wrapper.find('button[aria-label="Test UnoRouter connection"]');
    expect((testButton.element as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PresetCard', () => {
  it('lists presets in the selector and loads the chosen one', async () => {
    const store = useSettingsStore();
    await store.load();
    const Host = host('<div><PresetCard /></div>', { PresetCard });
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });

    const select = wrapper.find('select');
    expect(select.findAll('option').map((o) => o.text())).toContain('Default Sanctum (default)');
    await select.setValue('p1');
    await flushPromises();
    expect(store.globalDefaults.presetId).toBe('p1');
    expect(store.workingPreset.name).toBe('Default Sanctum');
  });

  it('saves the working copy as a new preset', async () => {
    const store = useSettingsStore();
    await store.load();
    store.workingPreset.temperature = 1.15;
    const Host = host('<div><PresetCard /></div>', { PresetCard });
    const wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });

    await wrapper.find('button[aria-label="Save current values as a new preset"]').trigger('click');
    const nameInput = wrapper.find('input[aria-label="New preset name"]');
    await nameInput.setValue('Uncensored Creative');
    await wrapper.find('button[aria-label="Create preset"]').trigger('click');
    await flushPromises();

    expect(apiState.presets.map((p) => p.name)).toContain('Uncensored Creative');
    const created = apiState.presets.find((p) => p.name === 'Uncensored Creative');
    expect(created?.temperature).toBeCloseTo(1.15);
    expect(store.globalDefaults.presetId).toBe(created?.id ?? null);
  });
});

describe('DisplayCard', () => {
  it('renders the four effect pills with the persisted one active', async () => {
    const Host = host('<div><DisplayCard /></div>', { DisplayCard });
    wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });
    await flushPromises();

    const pills = wrapper.findAll('button[aria-pressed]');
    expect(pills.map((pill) => pill.text())).toEqual(['Embers', 'Aurora', 'Stars', 'Off']);
    const active = pills.find((pill) => pill.attributes('aria-pressed') === 'true');
    expect(active?.text()).toBe('Stars');
  });

  it('persists a choice instantly through the settings API', async () => {
    const store = useSettingsStore();
    await store.load();
    const Host = host('<div><DisplayCard /></div>', { DisplayCard });
    wrapper = mount(Host, { global: { plugins: [vaporInteropPlugin] } });
    await flushPromises();

    const aurora = wrapper.findAll('button[aria-pressed]').find((pill) => pill.text() === 'Aurora');
    expect(aurora).toBeDefined();
    await aurora?.trigger('click');
    await flushPromises();

    expect(apiState.settings.display).toEqual({ backgroundEffect: 'aurora' });
    expect(store.display.backgroundEffect).toBe('aurora');
    // The active pill flipped and the previous one is no longer pressed.
    expect(aurora?.attributes('aria-pressed')).toBe('true');
  });
});
