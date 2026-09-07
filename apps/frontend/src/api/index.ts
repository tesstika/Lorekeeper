import type {
  Preset,
  PresetCreateInput,
  PresetPatch,
  ProviderId,
  ProviderInfo,
  ProviderModelsResponse,
  SettingsPatch,
  SettingsResponse,
  TestConnectionResponse,
} from '@lorekeeper/shared';

export interface ApiErrorDetail {
  keyword: string;
  path: string;
  message: string | null;
  params: unknown;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, code: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
  }
}

async function request<T>(method: string, path: string, payload?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    ...(payload !== undefined ? { headers: { 'content-type': 'application/json' } } : {}),
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const body = (data ?? {}) as { code?: string; message?: string; details?: ApiErrorDetail[] };
    throw new ApiError(
      body.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      body.code ?? 'http_error',
      body.details,
    );
  }
  return data as T;
}

export const api = {
  getSettings: () => request<SettingsResponse>('GET', '/settings'),
  patchSettings: (patch: SettingsPatch) => request<SettingsResponse>('PATCH', '/settings', patch),

  getProviders: () => request<ProviderInfo[]>('GET', '/providers'),
  setProviderKey: (id: ProviderId, key: string) =>
    request<{ ok: true; keyHint: string }>('PUT', `/providers/${id}/key`, { key }),
  clearProviderKey: (id: ProviderId) => request<{ ok: true }>('DELETE', `/providers/${id}/key`),
  testProvider: (id: ProviderId) =>
    request<TestConnectionResponse>('POST', `/providers/${id}/test`),
  getProviderModels: (id: ProviderId, refresh = false) =>
    request<ProviderModelsResponse>('GET', `/providers/${id}/models${refresh ? '?refresh=1' : ''}`),

  getPresets: () => request<Preset[]>('GET', '/presets'),
  createPreset: (input: PresetCreateInput) => request<Preset>('POST', '/presets', input),
  updatePreset: (id: string, patch: PresetPatch) =>
    request<Preset>('PATCH', `/presets/${id}`, patch),
  deletePreset: (id: string) => request<{ ok: true }>('DELETE', `/presets/${id}`),
};
