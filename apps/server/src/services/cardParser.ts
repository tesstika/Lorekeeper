import type { Character } from '@lorekeeper/shared';

export type CardFormat = 'v1' | 'v2' | 'v3';

const SPEC_V2 = 'chara_card_v2';
const SPEC_V3 = 'chara_card_v3';

/** Fields consumed into real character columns (removed from the extensions envelope). */
const MAPPED_DATA_FIELDS = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'alternate_greetings',
  'tags',
  'extensions',
]);

export class CardParseError extends Error {
  readonly code = 'invalid_card';
  constructor(message: string) {
    super(message);
    this.name = 'CardParseError';
  }
}

/**
 * Lossless round-trip envelope stored in the character's `extensions` column.
 * `fields` keeps every unmapped `data` key (creator, character_book, V3
 * assets/nickname/group_only_greetings, unknown future fields…), `extensions`
 * keeps the card's native `data.extensions` object, and `root` keeps unknown
 * root-level keys. Export rebuilds the original card from these.
 */
export interface LorekeeperCardEnvelope {
  spec?: typeof SPEC_V2 | typeof SPEC_V3 | undefined;
  spec_version?: string | undefined;
  fields?: Record<string, unknown> | undefined;
  extensions?: Record<string, unknown> | undefined;
  root?: Record<string, unknown> | undefined;
}

export interface ParsedCard {
  format: CardFormat;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
  creatorNotes: string;
  systemExtras: string;
  jailbreak: string;
  tags: string[];
  alternateGreetings: string[];
  extensions: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Detects the card format per plan D13: V3 root `{spec:'chara_card_v3',data}`,
 * V2 root `{spec:'chara_card_v2',data}`, legacy V1 flat object. Spec-less
 * `data`-envelope exports (in the wild) are treated as V2.
 */
export function detectCardFormat(payload: unknown): CardFormat | null {
  if (!isRecord(payload)) return null;
  const spec = payload.spec;
  if (spec === SPEC_V3) return 'v3';
  if (spec === SPEC_V2) return 'v2';
  if (typeof spec === 'string') return null; // unknown spec → reject
  return isRecord(payload.data) ? 'v2' : 'v1';
}

/**
 * Parses raw card JSON (Tavern V1 flat / SillyTavern V2 / V3) into character
 * input, mapping fields losslessly and preserving everything else in the
 * `extensions` round-trip envelope. Throws `CardParseError` on invalid input.
 */
export function parseCard(payload: unknown): ParsedCard {
  if (!isRecord(payload)) {
    throw new CardParseError('Character card must be a JSON object');
  }

  const format = detectCardFormat(payload);
  if (format === null) {
    const spec = typeof payload.spec === 'string' ? payload.spec : 'unknown';
    throw new CardParseError(
      `Unsupported card spec "${spec}" (expected chara_card_v2 or chara_card_v3)`,
    );
  }

  const isEnvelope = format === 'v2' || format === 'v3';
  const data: Record<string, unknown> = isEnvelope
    ? isRecord(payload.data)
      ? payload.data
      : {}
    : payload;

  const name = asString(data.name).trim();
  if (!name) {
    throw new CardParseError('Card is missing a usable "name" field');
  }

  // Everything except mapped fields + the native extensions object.
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!MAPPED_DATA_FIELDS.has(key)) fields[key] = value;
  }

  const envelope: LorekeeperCardEnvelope = { fields };
  if (isEnvelope) {
    envelope.spec = format === 'v3' ? SPEC_V3 : SPEC_V2;
    const specVersion = asString(payload.spec_version).trim();
    if (specVersion) envelope.spec_version = specVersion;
    const nativeExtensions = data.extensions;
    if (isRecord(nativeExtensions)) envelope.extensions = nativeExtensions;
    // Unknown root-level keys (rare, but part of a lossless round-trip).
    const root: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key !== 'spec' && key !== 'spec_version' && key !== 'data') root[key] = value;
    }
    if (Object.keys(root).length > 0) envelope.root = root;
  }

  return {
    format,
    name,
    description: asString(data.description),
    personality: asString(data.personality),
    scenario: asString(data.scenario),
    firstMessage: asString(data.first_mes),
    exampleDialogue: asString(data.mes_example),
    creatorNotes: asString(data.creator_notes),
    systemExtras: asString(data.system_prompt),
    jailbreak: asString(data.post_history_instructions),
    tags: asStringArray(data.tags)
      .map((tag) => tag.trim())
      .filter(Boolean),
    alternateGreetings: asStringArray(data.alternate_greetings),
    extensions: { lorekeeperCard: envelope },
  };
}

function getEnvelope(extensions: Record<string, unknown>): LorekeeperCardEnvelope {
  const raw = extensions.lorekeeperCard;
  if (!isRecord(raw)) return {};
  return {
    spec: raw.spec === SPEC_V2 || raw.spec === SPEC_V3 ? raw.spec : undefined,
    spec_version: typeof raw.spec_version === 'string' ? raw.spec_version : undefined,
    fields: isRecord(raw.fields) ? raw.fields : undefined,
    extensions: isRecord(raw.extensions) ? raw.extensions : undefined,
    root: isRecord(raw.root) ? raw.root : undefined,
  };
}

/**
 * Builds an exportable card JSON from a stored character. Default format is
 * SillyTavern V2 (`chara_card_v2` — the universal interchange baseline);
 * `v3` emits the `chara_card_v3` envelope. Stored round-trip metadata is
 * merged back so `export → import` reproduces the original card.
 */
export function buildCardExport(
  character: Character,
  format: 'v2' | 'v3' = 'v2',
): Record<string, unknown> {
  const envelope = getEnvelope(character.extensions);
  const data: Record<string, unknown> = {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    first_mes: character.firstMessage,
    mes_example: character.exampleDialogue,
    creator_notes: character.creatorNotes,
    system_prompt: character.systemExtras,
    post_history_instructions: character.jailbreak,
    alternate_greetings: [...character.alternateGreetings],
    tags: [...character.tags],
    creator: '',
    character_version: '',
    extensions: { ...envelope.extensions },
  };
  // Unmapped metadata (creator, character_book, assets, group_only_greetings…)
  // is restored where the source card carried it.
  Object.assign(data, envelope.fields);
  const root: Record<string, unknown> = { ...(envelope.root ?? {}) };
  root.spec = format === 'v3' ? SPEC_V3 : SPEC_V2;
  root.spec_version = format === 'v3' ? '3.0' : '2.0';
  root.data = data;
  return root;
}

/** Filesystem-safe download filename for an exported card. */
export function cardExportFilename(character: Character, format: 'v2' | 'v3'): string {
  const slug =
    character.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'character';
  return `${slug}.card.${format}.json`;
}
