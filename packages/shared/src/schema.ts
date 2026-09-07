import { z } from 'zod';
import { providerIds } from './enums';

// ---------------------------------------------------------------------------
// Default prompt template (plan §4.1)
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_TEMPLATE = `{systemExtras}
You are {{char}} in an ongoing roleplay with {{user}}.

<Character>
Name: {{char}}
{{#tagline}}Tagline: {{tagline}}{{/tagline}}
Appearance & description: {{description}}
Personality: {{personality}}
Behavior & mannerisms: {{behavior}}
Communication style: {{communicationStyle}}
Likes: {{likes}} | Dislikes: {{dislikes}}
Backstory: {{backstory}}
Scenario: {{scenario}}
{{/Character}}

<Persona>
{{user}}: {{personaDescription}}
</Persona>

<ExampleDialogue>
{{exampleDialogue}}
</ExampleDialogue>

Style rules (apply to every reply): keep *actions* in asterisks and spoken lines in "quotes". Stay in character; do not speak or act for {{user}}.`;

export const PROMPT_VARIABLES = [
  'char',
  'user',
  'tagline',
  'description',
  'personality',
  'behavior',
  'communicationStyle',
  'likes',
  'dislikes',
  'backstory',
  'scenario',
  'exampleDialogue',
  'systemExtras',
  'personaDescription',
  'personaName',
] as const;

export type PromptVariable = (typeof PROMPT_VARIABLES)[number];

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.enum(['ok', 'error']),
});

export type HealthResponse = z.output<typeof healthResponseSchema>;

// ---------------------------------------------------------------------------
// Settings sections (plan §3 — shapes stored in the `settings` kv table)
// ---------------------------------------------------------------------------

/**
 * AES-256-GCM envelope for an API key at rest. The ciphertext fields never
 * leave the server; clients only ever see `hint` (see providerInfoSchema).
 */
export const keyEnvelopeSchema = z.object({
  encrypted: z.string(),
  iv: z.string(),
  tag: z.string(),
  hint: z.string(),
});
export type KeyEnvelope = z.output<typeof keyEnvelopeSchema>;

/** `settings.apiKeys` row shape — one envelope per provider, null when absent. */
export const apiKeysSchema = z.object({
  openrouter: keyEnvelopeSchema.nullable().default(null),
  unorouter: keyEnvelopeSchema.nullable().default(null),
});
export type ApiKeys = z.output<typeof apiKeysSchema>;

export const providerIdSchema = z.enum(providerIds);

export const globalDefaultsSchema = z.object({
  providerId: providerIdSchema.nullable().default(null),
  modelId: z.string().min(1).max(200).nullable().default(null),
  presetId: z.string().nullable().default(null),
  personaId: z.string().nullable().default(null),
  contextBudgetTokens: z.number().int().min(1024).max(1_000_000).default(8192),
  keepLastNVariants: z.number().int().min(1).max(100).default(20),
});
export type GlobalDefaults = z.output<typeof globalDefaultsSchema>;
export type GlobalDefaultsPatch = z.input<typeof globalDefaultsSchema>;

export const promptTemplateSchema = z.object({
  systemTemplate: z.string().max(32_000).default(DEFAULT_SYSTEM_TEMPLATE),
  postHistoryInstructions: z.string().max(8_000).default(''),
});
export type PromptTemplate = z.output<typeof promptTemplateSchema>;
export type PromptTemplatePatch = z.input<typeof promptTemplateSchema>;

export const composerSchema = z.object({
  enterToSend: z.boolean().default(true),
  autoScroll: z.boolean().default(true),
  imageMaxBytes: z
    .number()
    .int()
    .min(64 * 1024)
    .max(32 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  editDefaultRegenerate: z.boolean().default(false),
  caretBlinkMs: z.number().int().min(100).max(2000).default(500),
  deliveredBlinkMs: z.number().int().min(50).max(2000).default(250),
  deliveredBlinks: z.number().int().min(1).max(30).default(6),
});
export type ComposerSettings = z.output<typeof composerSchema>;
export type ComposerPatch = z.input<typeof composerSchema>;

// ---------------------------------------------------------------------------
// PATCH schemas — deliberately built WITHOUT `.default()`: the type provider
// validates request bodies through the z.output direction, which injects every
// schema default into missing keys. A defaults-free partial keeps PATCH merges
// honest (only the sent keys change).
// ---------------------------------------------------------------------------

export const globalDefaultsPatchSchema = z.object({
  providerId: providerIdSchema.nullable().optional(),
  modelId: z.string().min(1).max(200).nullable().optional(),
  presetId: z.string().nullable().optional(),
  personaId: z.string().nullable().optional(),
  contextBudgetTokens: z.number().int().min(1024).max(1_000_000).optional(),
  keepLastNVariants: z.number().int().min(1).max(100).optional(),
});
export type GlobalDefaultsPatchValue = z.output<typeof globalDefaultsPatchSchema>;

export const promptTemplatePatchSchema = z.object({
  systemTemplate: z.string().max(32_000).optional(),
  postHistoryInstructions: z.string().max(8_000).optional(),
});
export type PromptTemplatePatchValue = z.output<typeof promptTemplatePatchSchema>;

export const composerPatchSchema = z.object({
  enterToSend: z.boolean().optional(),
  autoScroll: z.boolean().optional(),
  imageMaxBytes: z
    .number()
    .int()
    .min(64 * 1024)
    .max(32 * 1024 * 1024)
    .optional(),
  editDefaultRegenerate: z.boolean().optional(),
  caretBlinkMs: z.number().int().min(100).max(2000).optional(),
  deliveredBlinkMs: z.number().int().min(50).max(2000).optional(),
  deliveredBlinks: z.number().int().min(1).max(30).optional(),
});
export type ComposerPatchValue = z.output<typeof composerPatchSchema>;

/**
 * Response of GET/PATCH /api/settings. `apiKeys` is deliberately NOT part of
 * this response — key envelopes are exposed only through the provider
 * endpoints as `{ hasKey, keyHint }` (plan §2.5, zero key material client-side).
 */
export const settingsResponseSchema = z.object({
  globalDefaults: globalDefaultsSchema,
  promptTemplate: promptTemplateSchema,
  composer: composerSchema,
});
export type SettingsResponse = z.output<typeof settingsResponseSchema>;

export const settingsPatchSchema = z.object({
  globalDefaults: globalDefaultsPatchSchema.optional(),
  promptTemplate: promptTemplatePatchSchema.optional(),
  composer: composerPatchSchema.optional(),
});
export type SettingsPatch = z.output<typeof settingsPatchSchema>;

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const providerStatusSchema = z.enum(['connected', 'error', 'no_key']);
export type ProviderStatus = z.output<typeof providerStatusSchema>;

export const providerInfoSchema = z.object({
  id: providerIdSchema,
  label: z.string(),
  baseUrl: z.string(),
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  status: providerStatusSchema,
  latencyMs: z.number().nullable(),
  modelsFetchedAt: z.string().nullable(),
});
export type ProviderInfo = z.output<typeof providerInfoSchema>;

export const setProviderKeyBodySchema = z.object({
  key: z.string().min(8, 'API key must be at least 8 characters'),
});
export const setProviderKeyResponseSchema = z.object({
  ok: z.literal(true),
  keyHint: z.string(),
});

export const okResponseSchema = z.object({ ok: z.literal(true) });

export const testConnectionResponseSchema = z.object({
  status: z.enum(['connected', 'error']),
  latencyMs: z.number().nullable().default(null),
  code: z.string().nullable().default(null),
  message: z.string().nullable().default(null),
});
export type TestConnectionResponse = z.output<typeof testConnectionResponseSchema>;

// ---------------------------------------------------------------------------
// Models & model cache
// ---------------------------------------------------------------------------

export const modelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextLength: z.number().nullable(),
  inputModalities: z.array(z.string()),
  promptPrice: z.number().optional(),
  completionPrice: z.number().optional(),
});

/** Cached catalog stored in `settings` under `modelCache:<providerId>`. */
export const modelCacheSchema = z.object({
  fetchedAt: z.string(),
  models: z.array(modelInfoSchema),
});
export type ModelCache = z.output<typeof modelCacheSchema>;

export const providerModelsResponseSchema = z.object({
  models: z.array(modelInfoSchema),
  fetchedAt: z.string().nullable(),
  cached: z.boolean(),
});
export type ProviderModelsResponse = z.output<typeof providerModelsResponseSchema>;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const presetInputSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  temperature: z.number().min(0).max(2).default(0.85),
  topP: z.number().min(0).max(1).default(0.92),
  topK: z.number().int().min(0).max(200).nullable().default(null),
  maxTokens: z.number().int().min(1).max(1_000_000).default(4096),
  frequencyPenalty: z.number().min(-2).max(2).default(0),
  presencePenalty: z.number().min(-2).max(2).default(0),
  repetitionPenalty: z.number().min(0.1).max(3).nullable().default(null),
  stopSequences: z.array(z.string().min(1).max(64)).max(16).default([]),
  isDefault: z.boolean().default(false),
});
export type PresetInput = z.output<typeof presetInputSchema>;
export type PresetCreateInput = z.input<typeof presetInputSchema>;

export const presetSchema = presetInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Preset = z.output<typeof presetSchema>;

export const presetPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(0).max(200).nullable().optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  repetitionPenalty: z.number().min(0.1).max(3).nullable().optional(),
  stopSequences: z.array(z.string().min(1).max(64)).max(16).optional(),
  isDefault: z.boolean().optional(),
});
export type PresetPatch = z.output<typeof presetPatchSchema>;
