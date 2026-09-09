import {
  type ComposerPatch,
  composerSchema,
  type GlobalDefaultsPatch,
  globalDefaultsSchema,
  type Preset,
  type PresetCreateInput,
  type PresetPatch,
  type PromptTemplatePatch,
  type ProviderId,
  type ProviderInfo,
  type ProviderModelsResponse,
  presetInputSchema,
  promptTemplateSchema,
  type SettingsResponse,
  type TestConnectionResponse,
} from '@lorekeeper/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api';
import { describeApiError } from '@/utils/errors';
import { useUiStore } from './ui';

export type PresetDraft = ReturnType<typeof presetInputSchema.parse>;

/**
 * Mirror of the server settings state (plan §6.4): the SPA's single source of
 * truth for settings, provider statuses, the model catalog cache and presets.
 * Survives route navigation (pinia) and persists through the REST API.
 */
export const useSettingsStore = defineStore('settings', () => {
  const ui = useUiStore();

  const settings = ref<SettingsResponse | null>(null);
  const providers = ref<ProviderInfo[]>([]);
  const presets = ref<Preset[]>([]);
  const modelCatalog = ref<Partial<Record<ProviderId, ProviderModelsResponse>>>({});
  const loaded = ref(false);
  const loading = ref(false);
  /** Unified error state (M4): surfaces a Retry banner on the Settings page. */
  const loadError = ref<string | null>(null);

  /** The preset currently being tuned in the Sampling section (working copy). */
  const DRAFT_PRESET = presetInputSchema.parse({ name: 'Untitled' });
  const workingPreset = ref<PresetDraft>(structuredClone(DRAFT_PRESET));
  const newPresetName = ref('');

  const globalDefaults = computed(
    () => settings.value?.globalDefaults ?? globalDefaultsSchema.parse({}),
  );
  const composer = computed(() => settings.value?.composer ?? composerSchema.parse({}));
  const promptTemplate = computed(
    () => settings.value?.promptTemplate ?? promptTemplateSchema.parse({}),
  );

  const activeProviderId = computed(() => globalDefaults.value.providerId);
  const activeModelId = computed(() => globalDefaults.value.modelId);
  const activePresetId = computed(() => globalDefaults.value.presetId);
  const activePreset = computed(
    () => presets.value.find((p) => p.id === activePresetId.value) ?? null,
  );
  const activeProvider = computed(
    () => providers.value.find((p) => p.id === activeProviderId.value) ?? null,
  );
  const activeProviderCatalog = computed(() =>
    activeProviderId.value ? (modelCatalog.value[activeProviderId.value] ?? null) : null,
  );
  const activeModelInfo = computed(
    () => activeProviderCatalog.value?.models.find((m) => m.id === activeModelId.value) ?? null,
  );
  const engineReady = computed(
    () =>
      activeProviderId.value !== null &&
      activeModelId.value !== null &&
      (activeProvider.value?.status ?? 'no_key') === 'connected',
  );

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      const [settingsResponse, providerList, presetList] = await Promise.all([
        api.getSettings(),
        api.getProviders(),
        api.getPresets(),
      ]);
      settings.value = settingsResponse;
      providers.value = providerList;
      presets.value = presetList;
      loaded.value = true;
      loadError.value = null;
      syncWorkingPreset();
    } catch (error) {
      const message = describeApiError(error);
      loadError.value = message;
      ui.notify(message, 'error');
    } finally {
      loading.value = false;
    }
  }

  function syncWorkingPreset(): void {
    const preset = presets.value.find((p) => p.id === globalDefaults.value.presetId);
    workingPreset.value = preset ? clonePreset(preset) : structuredClone(DRAFT_PRESET);
  }

  function clonePreset(preset: Preset): PresetDraft {
    return {
      name: preset.name,
      description: preset.description,
      temperature: preset.temperature,
      topP: preset.topP,
      topK: preset.topK,
      maxTokens: preset.maxTokens,
      frequencyPenalty: preset.frequencyPenalty,
      presencePenalty: preset.presencePenalty,
      repetitionPenalty: preset.repetitionPenalty,
      stopSequences: [...preset.stopSequences],
      isDefault: preset.isDefault,
    };
  }

  async function patchSettings(
    section: 'globalDefaults' | 'promptTemplate' | 'composer',
    patch: Partial<GlobalDefaultsPatch & PromptTemplatePatch & ComposerPatch>,
  ): Promise<void> {
    try {
      settings.value = await api.patchSettings({ [section]: patch });
    } catch (error) {
      ui.notify(describeApiError(error), 'error');
      throw error;
    }
  }

  function updateGlobalDefaults(patch: GlobalDefaultsPatch): Promise<void> {
    return patchSettings('globalDefaults', patch).then(syncWorkingPreset);
  }

  function updatePromptTemplate(patch: PromptTemplatePatch): Promise<void> {
    return patchSettings('promptTemplate', patch);
  }

  function updateComposer(patch: ComposerPatch): Promise<void> {
    return patchSettings('composer', patch);
  }

  /** Resets the three editable sections to their schema defaults (Settings → Reset). */
  async function resetToDefaults(): Promise<void> {
    await patchSettings('globalDefaults', globalDefaultsSchema.parse({}));
    await patchSettings('promptTemplate', promptTemplateSchema.parse({}));
    await patchSettings('composer', composerSchema.parse({}));
    syncWorkingPreset();
    ui.notify('Settings restored to defaults', 'success');
  }

  async function refreshProviders(): Promise<void> {
    providers.value = await api.getProviders();
  }

  async function saveProviderKey(id: ProviderId, key: string): Promise<string> {
    const { keyHint } = await api.setProviderKey(id, key);
    await refreshProviders();
    const label = providers.value.find((p) => p.id === id)?.label ?? id;
    ui.notify(`${label} key saved (${keyHint})`, 'success');
    return keyHint;
  }

  async function clearProviderKey(id: ProviderId): Promise<void> {
    await api.clearProviderKey(id);
    await refreshProviders();
    const label = providers.value.find((p) => p.id === id)?.label ?? id;
    ui.notify(`${label} key removed`, 'info');
  }

  async function testProvider(id: ProviderId): Promise<TestConnectionResponse> {
    const result = await api.testProvider(id);
    await refreshProviders();
    return result;
  }

  async function fetchProviderModels(
    id: ProviderId,
    refresh = false,
  ): Promise<ProviderModelsResponse> {
    const result = await api.getProviderModels(id, refresh);
    modelCatalog.value = { ...modelCatalog.value, [id]: result };
    return result;
  }

  /** Mirrors the server's single-default invariant into the local list. */
  function upsertPreset(preset: Preset): void {
    const index = presets.value.findIndex((p) => p.id === preset.id);
    if (index >= 0) {
      presets.value.splice(index, 1, preset);
    } else {
      presets.value.push(preset);
    }
    if (preset.isDefault) {
      presets.value = presets.value.map((p) =>
        p.id === preset.id ? p : { ...p, isDefault: false },
      );
    }
  }

  async function createPreset(input: PresetCreateInput): Promise<Preset> {
    const preset = await api.createPreset(input);
    upsertPreset(preset);
    return preset;
  }

  async function updatePreset(id: string, patch: PresetPatch): Promise<Preset> {
    const updated = await api.updatePreset(id, patch);
    upsertPreset(updated);
    return updated;
  }

  async function deletePreset(id: string): Promise<void> {
    await api.deletePreset(id);
    presets.value = presets.value.filter((p) => p.id !== id);
    if (globalDefaults.value.presetId === id) {
      await updateGlobalDefaults({ presetId: null });
      return;
    }
    syncWorkingPreset();
  }

  /** Loads a preset as the working target for the Sampling section. */
  async function selectPreset(id: string | null): Promise<void> {
    await updateGlobalDefaults({ presetId: id });
  }

  async function setDefaultPreset(id: string): Promise<void> {
    const updated = await updatePreset(id, { isDefault: true });
    ui.notify(`“${updated.name}” is now the default preset`, 'success');
    await updateGlobalDefaults({ presetId: id });
  }

  async function saveWorkingAsNew(name: string): Promise<Preset> {
    const preset = await createPreset({ ...workingPreset.value, name, isDefault: false });
    await updateGlobalDefaults({ presetId: preset.id });
    workingPreset.value = clonePreset(preset);
    ui.notify(`Preset “${preset.name}” saved`, 'success');
    return preset;
  }

  async function updateCurrentPreset(): Promise<void> {
    if (!activePresetId.value) throw new Error('No preset selected to update');
    const updated = await updatePreset(activePresetId.value, workingPreset.value);
    workingPreset.value = clonePreset(updated);
    ui.notify(`Preset “${updated.name}” updated`, 'success');
  }

  return {
    settings,
    providers,
    presets,
    modelCatalog,
    loaded,
    loading,
    loadError,
    workingPreset,
    newPresetName,
    globalDefaults,
    composer,
    promptTemplate,
    activeProviderId,
    activeModelId,
    activePresetId,
    activePreset,
    activeProvider,
    activeProviderCatalog,
    activeModelInfo,
    engineReady,
    load,
    patchSettings,
    updateGlobalDefaults,
    updatePromptTemplate,
    updateComposer,
    resetToDefaults,
    refreshProviders,
    saveProviderKey,
    clearProviderKey,
    testProvider,
    fetchProviderModels,
    createPreset,
    updatePreset,
    deletePreset,
    selectPreset,
    setDefaultPreset,
    saveWorkingAsNew,
    updateCurrentPreset,
    syncWorkingPreset,
  };
});
