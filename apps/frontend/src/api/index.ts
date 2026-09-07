import type {
  AttachmentResponse,
  CardExportFormat,
  Character,
  CharacterCreateInput,
  CharacterPatch,
  ImportCardResponse,
  Persona,
  PersonaCreateInput,
  PersonaPatch,
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

  getCharacters: () => request<Character[]>('GET', '/characters'),
  getCharacter: (id: string) => request<Character>('GET', `/characters/${id}`),
  createCharacter: (input: CharacterCreateInput) =>
    request<Character>('POST', '/characters', input),
  updateCharacter: (id: string, patch: CharacterPatch) =>
    request<Character>('PATCH', `/characters/${id}`, patch),
  deleteCharacter: (id: string, force = false) =>
    request<{ ok: true }>('DELETE', `/characters/${id}${force ? '?force=1' : ''}`),
  importCard: (payload: unknown) =>
    request<ImportCardResponse>('POST', '/characters/import', payload),

  getPersonas: () => request<Persona[]>('GET', '/personas'),
  getPersona: (id: string) => request<Persona>('GET', `/personas/${id}`),
  createPersona: (input: PersonaCreateInput) => request<Persona>('POST', '/personas', input),
  updatePersona: (id: string, patch: PersonaPatch) =>
    request<Persona>('PATCH', `/personas/${id}`, patch),
  deletePersona: (id: string) => request<{ ok: true }>('DELETE', `/personas/${id}`),
  setDefaultPersona: (id: string) =>
    request<{ persona: Persona }>('PUT', `/personas/${id}/default`),

  uploadAttachment: (file: File): Promise<AttachmentResponse> => {
    const form = new FormData();
    form.append('file', file);
    return fetch('/api/attachments', { method: 'POST', body: form }).then(async (response) => {
      const body = (await response.json().catch(() => null)) as
        | (AttachmentResponse & { code?: string; message?: string })
        | null;
      if (!response.ok || !body) {
        throw new ApiError(
          body?.message ?? `Upload failed with HTTP ${response.status}`,
          response.status,
          body?.code ?? 'http_error',
        );
      }
      return body;
    });
  },

  /** Triggers a browser download of the character's exported card JSON. */
  exportCharacterCard: (id: string, format: CardExportFormat = 'v2'): void => {
    const anchor = document.createElement('a');
    anchor.href = `/api/characters/${id}/export${format === 'v3' ? '?format=v3' : ''}`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  },
};
