import { z } from 'zod';
import { chatStatuses, messageRoles, providerIds } from './enums';

// ---------------------------------------------------------------------------
// Default prompt template (plan §4.1)
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_TEMPLATE = `{{systemExtras}}
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

// ---------------------------------------------------------------------------
// Characters & personas (plan §3, §6.2, §10 M2)
// ---------------------------------------------------------------------------

/** Prose fields of a card can be very large; the cap keeps DoS bounded. */
const longText = z.string().max(200_000);
const shortText = z.string().max(8_000);

const jsonRecord = z.record(z.string(), z.unknown());

export const characterInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  tagline: z.string().max(300).nullable().default(null),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
  avatarPath: z.string().max(500).nullable().default(null),
  description: longText.default(''),
  creatorNotes: longText.default(''),
  extensions: jsonRecord.default({}),
  personality: longText.default(''),
  behavior: longText.default(''),
  communicationStyle: longText.default(''),
  likes: shortText.default(''),
  dislikes: shortText.default(''),
  backstory: longText.default(''),
  scenario: longText.default(''),
  exampleDialogue: longText.default(''),
  firstMessage: longText.default(''),
  alternateGreetings: z.array(longText).max(20).default([]),
  systemExtras: longText.default(''),
  jailbreak: longText.default(''),
});
export type CharacterInput = z.output<typeof characterInputSchema>;
export type CharacterCreateInput = z.input<typeof characterInputSchema>;

export const characterSchema = characterInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Character = z.output<typeof characterSchema>;

/**
 * Defaults-free PATCH (M1 §4.2 lesson): fastify-type-provider-zod v7 validates
 * request bodies through the z.output direction, which injects every schema
 * default into missing keys. Every key here is `.optional()` with ZERO
 * `.default()` so a partial PATCH never clobbers untouched fields.
 */
export const characterPatchSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120).optional(),
  tagline: z.string().max(300).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  avatarPath: z.string().max(500).nullable().optional(),
  description: longText.optional(),
  creatorNotes: longText.optional(),
  extensions: jsonRecord.optional(),
  personality: longText.optional(),
  behavior: longText.optional(),
  communicationStyle: longText.optional(),
  likes: shortText.optional(),
  dislikes: shortText.optional(),
  backstory: longText.optional(),
  scenario: longText.optional(),
  exampleDialogue: longText.optional(),
  firstMessage: longText.optional(),
  alternateGreetings: z.array(longText).max(20).optional(),
  systemExtras: longText.optional(),
  jailbreak: longText.optional(),
});
export type CharacterPatch = z.output<typeof characterPatchSchema>;

export const personaInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  description: longText.default(''),
  avatarPath: z.string().max(500).nullable().default(null),
  isDefault: z.boolean().default(false),
});
export type PersonaInput = z.output<typeof personaInputSchema>;
export type PersonaCreateInput = z.input<typeof personaInputSchema>;

export const personaSchema = personaInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Persona = z.output<typeof personaSchema>;

export const personaPatchSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120).optional(),
  description: longText.optional(),
  avatarPath: z.string().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type PersonaPatch = z.output<typeof personaPatchSchema>;

/** `PUT /api/personas/:id/default` → `{ persona }`. */
export const personaDefaultResponseSchema = z.object({ persona: personaSchema });
export type PersonaDefaultResponse = z.output<typeof personaDefaultResponseSchema>;

// -- Character card import / export (plan D13, §7.1) --------------------------

export const cardSpecs = ['chara_card_v2', 'chara_card_v3'] as const;
export type CardSpec = (typeof cardSpecs)[number];

export const cardExportFormats = ['v2', 'v3'] as const;
export type CardExportFormat = (typeof cardExportFormats)[number];

/**
 * Legacy flat Tavern V1 card: `{ name, description, personality, scenario,
 * first_mes, mes_example }` (plus anything else the generator added).
 */
export const tavernCardV1Schema = z.looseObject({
  name: z.string().min(1),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  first_mes: z.string().optional(),
  mes_example: z.string().optional(),
});

/** Loose `data` payload of V2 cards (unknown fields tolerated + preserved). */
export const cardDataV2Schema = z.looseObject({
  name: z.string().min(1),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  first_mes: z.string().optional(),
  mes_example: z.string().optional(),
  creator_notes: z.string().optional(),
  system_prompt: z.string().optional(),
  post_history_instructions: z.string().optional(),
  alternate_greetings: z.array(z.string()).optional(),
  character_book: z.unknown().optional(),
  tags: z.array(z.string()).optional(),
  creator: z.string().optional(),
  character_version: z.string().optional(),
  extensions: jsonRecord.optional(),
});

/** V3 card root: `{ spec: 'chara_card_v3', spec_version: '3.0', data }`. */
export const characterCardV3Schema = z.looseObject({
  spec: z.literal('chara_card_v3'),
  spec_version: z.string().optional(),
  data: cardDataV2Schema,
});

/** V2 card root: `{ spec: 'chara_card_v2', spec_version: '2.0', data }`. */
export const characterCardV2Schema = z.looseObject({
  spec: z.literal('chara_card_v2'),
  spec_version: z.string().optional(),
  data: cardDataV2Schema,
});

export const characterCardUnionSchema = z.union([
  characterCardV3Schema,
  characterCardV2Schema,
  tavernCardV1Schema,
]);

export const importCardResponseSchema = z.object({
  character: characterSchema,
  detectedFormat: z.enum(['v1', 'v2', 'v3']),
});
export type ImportCardResponse = z.output<typeof importCardResponseSchema>;

/** V2 export — the universal interchange baseline (plan D13). */
export const exportedCardV2Schema = z.object({
  spec: z.literal('chara_card_v2'),
  spec_version: z.string(),
  data: jsonRecord,
});
export type ExportedCardV2 = z.output<typeof exportedCardV2Schema>;

/** Optional V3 export (`?format=v3`). */
export const exportedCardV3Schema = z.object({
  spec: z.literal('chara_card_v3'),
  spec_version: z.string(),
  data: jsonRecord,
});
export type ExportedCardV3 = z.output<typeof exportedCardV3Schema>;

// -- Attachments (avatar/image uploads, plan §7.1) -----------------------------

export const attachmentResponseSchema = z.object({
  id: z.string(),
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  originalName: z.string(),
});
export type AttachmentResponse = z.output<typeof attachmentResponseSchema>;

// ---------------------------------------------------------------------------
// Chats & messages (plan §3.1, §7.1 — M3)
// ---------------------------------------------------------------------------

/** Zod mirror of the `TokenUsage` interface in types.ts (drizzle $type + API). */
export const tokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  costUsd: z.number().optional(),
});

/** Zod mirror of the `ChatError` interface in types.ts (inline errors, D10). */
export const chatErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  statusCode: z.number().optional(),
  retryAfterMs: z.number().optional(),
});
/** API-level ChatError (z.output — optional keys may be explicitly undefined). */
export type ChatErrorData = z.output<typeof chatErrorSchema>;

export const chatStatusSchema = z.enum(chatStatuses);

// -- Chat CRUD ----------------------------------------------------------------

export const createChatInputSchema = z.object({
  characterId: z.string().min(1),
  personaId: z.string().nullable().optional(),
  providerId: providerIdSchema.nullable().optional(),
  modelId: z.string().max(200).nullable().optional(),
  presetId: z.string().nullable().optional(),
});
export type CreateChatInput = z.output<typeof createChatInputSchema>;

export const chatSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  personaId: z.string().nullable(),
  title: z.string(),
  ribbon: z.string().nullable(),
  status: chatStatusSchema,
  providerId: providerIdSchema.nullable(),
  modelId: z.string().nullable(),
  presetId: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
  createdAt: z.string(),
});
export type Chat = z.output<typeof chatSchema>;

export const chatSummarySchema = chatSchema.omit({ characterId: true }).extend({
  characterName: z.string(),
  characterAvatarPath: z.string().nullable(),
});
export type ChatSummary = z.output<typeof chatSummarySchema>;

export const chatsListQuerySchema = z.object({
  status: chatStatusSchema.optional(),
  q: z.string().max(200).optional(),
});

/**
 * Defaults-free PATCH (M1 §4.2 lesson): every key `.optional()`, ZERO
 * `.default()` so a partial PATCH never clobbers untouched fields.
 */
export const chatPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  ribbon: z.string().max(300).nullable().optional(),
  personaId: z.string().nullable().optional(),
  providerId: providerIdSchema.nullable().optional(),
  modelId: z.string().max(200).nullable().optional(),
  presetId: z.string().nullable().optional(),
  status: chatStatusSchema.optional(),
});
export type ChatPatch = z.output<typeof chatPatchSchema>;

export const deleteChatResponseSchema = z.object({ ok: z.literal(true) });

// -- Variants & messages --------------------------------------------------------

export const variantSchema = z.object({
  id: z.string(),
  variantIndex: z.number().int(),
  isActive: z.boolean(),
  text: z.string(),
  finishReason: z.string().nullable(),
  isError: z.boolean(),
  error: chatErrorSchema.nullable(),
  usage: tokenUsageSchema.nullable(),
  createdAt: z.string(),
});
export type Variant = z.output<typeof variantSchema>;

export const attachmentInfoSchema = z.object({
  id: z.string(),
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  mimeType: z.string(),
  originalName: z.string(),
});
export type AttachmentInfo = z.output<typeof attachmentInfoSchema>;

/**
 * One logical message position: assistant groups carry every variant with
 * `activeVariantId` marking the swipe target; user messages carry a single
 * variant (plan §3.1).
 */
export const chatMessageSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  role: z.enum(messageRoles),
  groupId: z.string().nullable(),
  isGreeting: z.boolean(),
  isError: z.boolean(),
  error: chatErrorSchema.nullable(),
  variants: z.array(variantSchema),
  activeVariantId: z.string().nullable(),
  attachments: z.array(attachmentInfoSchema),
  usage: tokenUsageSchema.nullable(),
  finishReason: z.string().nullable(),
});
export type ChatMessage = z.output<typeof chatMessageSchema>;

export const chatDetailSchema = z.object({
  chat: chatSchema,
  character: characterSchema,
  persona: personaSchema.nullable(),
  messages: z.array(chatMessageSchema),
});
export type ChatDetail = z.output<typeof chatDetailSchema>;

export const messageInputSchema = z.object({
  text: z.string().min(1, 'Message text is required').max(32_000),
  attachmentIds: z.array(z.string().min(1)).max(4).optional(),
});
export type MessageInput = z.output<typeof messageInputSchema>;

/** Defaults-free edit body (`regenerateAfter` optional, no `.default()`). */
export const editMessageInputSchema = z.object({
  text: z.string().min(1, 'Message text is required').max(32_000),
  regenerateAfter: z.boolean().optional(),
});
export type EditMessageInput = z.output<typeof editMessageInputSchema>;

export const sendMessageResponseSchema = z.object({ message: chatMessageSchema });
export type SendMessageResponse = z.output<typeof sendMessageResponseSchema>;

export const editMessageResponseSchema = z.object({
  message: chatMessageSchema,
  truncatedSeq: z.number().int().nullable(),
});
export type EditMessageResponse = z.output<typeof editMessageResponseSchema>;

export const deleteMessageResponseSchema = z.object({ deletedIds: z.array(z.string()) });
export type DeleteMessageResponse = z.output<typeof deleteMessageResponseSchema>;

export const activateVariantInputSchema = z.object({ variantId: z.string().min(1) });
export const activateVariantResponseSchema = z.object({ message: chatMessageSchema });

export const deleteMessageQuerySchema = z.object({ withReplies: z.string().optional() });

// -- SSE generation events (plan §7.2) -----------------------------------------

export const sseMetaEventSchema = z.object({
  type: z.literal('meta'),
  messageId: z.string(),
  groupId: z.string(),
  seq: z.number().int(),
});
export const sseDeltaEventSchema = z.object({
  type: z.literal('delta'),
  text: z.string(),
});
export const sseDoneEventSchema = z.object({
  type: z.literal('done'),
  finishReason: z.enum(['stop', 'length', 'aborted']),
  usage: tokenUsageSchema.optional(),
});
export const sseErrorEventSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  statusCode: z.number().optional(),
  retryAfterMs: z.number().optional(),
});

export const sseEventSchema = z.discriminatedUnion('type', [
  sseMetaEventSchema,
  sseDeltaEventSchema,
  sseDoneEventSchema,
  sseErrorEventSchema,
]);
export type SseMetaEvent = z.output<typeof sseMetaEventSchema>;
export type SseDeltaEvent = z.output<typeof sseDeltaEventSchema>;
export type SseDoneEvent = z.output<typeof sseDoneEventSchema>;
export type SseErrorEvent = z.output<typeof sseErrorEventSchema>;
export type SseEvent = z.output<typeof sseEventSchema>;

/** SSE endpoint request bodies are empty; declared for the client contract. */
export const sseGenerateBodySchema = z.object({}).optional();
