import type { Character } from '@lorekeeper/shared';
import { describe, expect, it } from 'vitest';
import {
  buildCardExport,
  cardExportFilename,
  detectCardFormat,
  type LorekeeperCardEnvelope,
  parseCard,
} from '../services/cardParser';

const V2_CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Lady Vivienne',
    description: 'Victorian occultist.',
    personality: 'Sharp-witted, guarded.',
    scenario: 'Midnight at the West Wing study.',
    first_mes: '*The clock strikes three.* "Tell me—did the rain follow you down?"',
    mes_example: '<START>\n{{user}}: Hello\n{{char}}: "Comprehension, not forgiveness."',
    creator_notes: 'Lorekeeper test fixture.',
    system_prompt: 'Never break character.',
    post_history_instructions: 'Stay in the 1890s.',
    alternate_greetings: ['*She looks up.* "You are late."', '*The hounds stir.*'],
    character_book: { name: 'Valois Grimoire', entries: [{ keys: ['curse'], content: '…' }] },
    tags: ['Noir', 'Victorian'],
    creator: 'Testika',
    character_version: '1.2',
    extensions: { depth_prompt: { prompt: 'Speaks in riddles', weight: 4 } },
    custom_unknown_field: { kept: true },
  },
};

const V3_CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    ...V2_CARD.data,
    nickname: 'Vivienne',
    assets: [{ type: 'icon', uri: 'embeded://main.png', name: 'main', ext: 'png' }],
    creator_notes_multilingual: { en: 'Lorekeeper test fixture.', jp: 'テスト' },
    source: ['https://example.com/origin'],
    group_only_greetings: ['*For the whole party.*'],
    creation_date: 1725667200000,
    modification_date: 1725753600000,
  },
};

const V1_CARD = {
  name: 'Captain Vance',
  description: 'Aether-naut of the Vesper.',
  personality: 'Brass, storm-weathered.',
  scenario: 'Airship deck at dusk.',
  first_mes: '*The spyglass lowers.* "Steady, she blows."',
  mes_example: 'Dialogue example.',
  creatorcomment: 'Tavern-era metadata.',
  avatar: 'none',
};

function envelopeOf(character: { extensions: Record<string, unknown> }): LorekeeperCardEnvelope {
  const raw = character.extensions.lorekeeperCard;
  expect(raw).toBeTypeOf('object');
  return raw as LorekeeperCardEnvelope;
}

function characterFromParsed(parsed: ReturnType<typeof parseCard>): Character {
  return {
    id: 'c-test',
    name: parsed.name,
    tagline: null,
    tags: parsed.tags,
    avatarPath: null,
    description: parsed.description,
    creatorNotes: parsed.creatorNotes,
    extensions: parsed.extensions,
    personality: parsed.personality,
    behavior: '',
    communicationStyle: '',
    likes: '',
    dislikes: '',
    backstory: '',
    scenario: parsed.scenario,
    exampleDialogue: parsed.exampleDialogue,
    firstMessage: parsed.firstMessage,
    alternateGreetings: parsed.alternateGreetings,
    systemExtras: parsed.systemExtras,
    jailbreak: parsed.jailbreak,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
  };
}

describe('detectCardFormat', () => {
  it('detects V3, V2 and V1 payloads', () => {
    expect(detectCardFormat(V3_CARD)).toBe('v3');
    expect(detectCardFormat(V2_CARD)).toBe('v2');
    expect(detectCardFormat(V1_CARD)).toBe('v1');
    // Spec-less data envelope (in-the-wild export) → treated as V2.
    expect(detectCardFormat({ data: { name: 'X' } })).toBe('v2');
  });

  it('rejects non-objects and unknown specs', () => {
    expect(detectCardFormat(null)).toBeNull();
    expect(detectCardFormat('nope')).toBeNull();
    expect(detectCardFormat({ spec: 'chara_card_v9' })).toBeNull();
  });
});

describe('parseCard', () => {
  it('maps a V2 card onto character fields', () => {
    const parsed = parseCard(V2_CARD);
    expect(parsed.format).toBe('v2');
    expect(parsed.name).toBe('Lady Vivienne');
    expect(parsed.description).toBe('Victorian occultist.');
    expect(parsed.personality).toBe('Sharp-witted, guarded.');
    expect(parsed.scenario).toBe('Midnight at the West Wing study.');
    expect(parsed.firstMessage).toContain('clock strikes three');
    expect(parsed.exampleDialogue).toContain('Comprehension, not forgiveness.');
    expect(parsed.creatorNotes).toBe('Lorekeeper test fixture.');
    expect(parsed.systemExtras).toBe('Never break character.');
    expect(parsed.jailbreak).toBe('Stay in the 1890s.');
    expect(parsed.tags).toEqual(['Noir', 'Victorian']);
    expect(parsed.alternateGreetings).toHaveLength(2);
  });

  it('preserves unmapped V2 metadata for a lossless round-trip', () => {
    const env = envelopeOf(parseCard(V2_CARD));
    expect(env.spec).toBe('chara_card_v2');
    expect(env.spec_version).toBe('2.0');
    expect(env.fields).toMatchObject({
      creator: 'Testika',
      character_version: '1.2',
      character_book: { name: 'Valois Grimoire' },
      custom_unknown_field: { kept: true },
    });
    expect(env.extensions).toEqual({ depth_prompt: { prompt: 'Speaks in riddles', weight: 4 } });
    // Mapped fields must not leak into the preserved envelope.
    expect(env.fields?.first_mes).toBeUndefined();
    expect(env.fields?.tags).toBeUndefined();
  });

  it('preserves V3-only fields (assets, nickname, group_only_greetings…)', () => {
    const parsed = parseCard(V3_CARD);
    expect(parsed.format).toBe('v3');
    const env = envelopeOf(parsed);
    expect(env.spec).toBe('chara_card_v3');
    expect(env.fields).toMatchObject({
      nickname: 'Vivienne',
      assets: [{ type: 'icon', uri: 'embeded://main.png' }],
      creator_notes_multilingual: { en: 'Lorekeeper test fixture.' },
      source: ['https://example.com/origin'],
      group_only_greetings: ['*For the whole party.*'],
      creation_date: 1725667200000,
      modification_date: 1725753600000,
    });
  });

  it('parses a legacy flat V1 card and preserves unknown keys', () => {
    const parsed = parseCard(V1_CARD);
    expect(parsed.format).toBe('v1');
    expect(parsed.name).toBe('Captain Vance');
    expect(parsed.firstMessage).toContain('spyglass lowers');
    const env = envelopeOf(parsed);
    expect(env.spec).toBeUndefined();
    expect(env.fields).toMatchObject({ creatorcomment: 'Tavern-era metadata.', avatar: 'none' });
  });

  it('rejects non-objects, unknown specs and missing names', () => {
    expect(() => parseCard('nope')).toThrow(/JSON object/);
    expect(() => parseCard([])).toThrow(/JSON object/);
    expect(() => parseCard({ spec: 'chara_card_v7', data: {} })).toThrow(/Unsupported card spec/);
    expect(() => parseCard({ data: { description: 'no name' } })).toThrow(/name/);
    expect(() => parseCard({ description: 'no name' })).toThrow(/name/);
  });

  it('coerces sloppy real-world payloads tolerantly', () => {
    const parsed = parseCard({
      spec: 'chara_card_v2',
      data: {
        name: 'Messy',
        alternate_greetings: 'not-an-array',
        tags: [1, 'ok', null, 'Noir'],
      },
    });
    expect(parsed.alternateGreetings).toEqual([]);
    expect(parsed.tags).toEqual(['ok', 'Noir']);
  });
});

describe('buildCardExport', () => {
  it('exports a stored character as a valid V2 card', () => {
    const parsed = parseCard(V2_CARD);
    const character = characterFromParsed(parsed);
    const card = buildCardExport(character, 'v2');
    expect(card.spec).toBe('chara_card_v2');
    expect(card.spec_version).toBe('2.0');
    const data = card.data as Record<string, unknown>;
    expect(data).toMatchObject({
      name: 'Lady Vivienne',
      description: 'Victorian occultist.',
      post_history_instructions: 'Stay in the 1890s.',
      system_prompt: 'Never break character.',
      creator: 'Testika',
      character_version: '1.2',
      tags: ['Noir', 'Victorian'],
    });
    expect(data.extensions).toEqual({ depth_prompt: { prompt: 'Speaks in riddles', weight: 4 } });
    expect(data.character_book).toMatchObject({ name: 'Valois Grimoire' });
  });

  it('re-importing an export reproduces the original card (round-trip fidelity)', () => {
    const first = parseCard(V3_CARD);
    const reimported = parseCard(buildCardExport(characterFromParsed(first), 'v3'));
    expect(reimported).toEqual(first);
    // The V2 envelope round-trips through a V2 export as well.
    const firstV2 = parseCard(V2_CARD);
    const reimportedV2 = parseCard(buildCardExport(characterFromParsed(firstV2), 'v2'));
    expect(reimportedV2).toEqual(firstV2);
  });

  it('reaches the round-trip fixpoint in one cycle for minimal cards', () => {
    const minimal = parseCard({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      // No creator/character_version keys; carries the mandatory extensions object.
      data: { name: 'Minimalist', description: 'No creator keys.', extensions: {} },
    });
    const exported = buildCardExport(characterFromParsed(minimal), 'v2');
    // export(import(card)) must re-import to the exact same parsed shape…
    expect(parseCard(exported)).toEqual(minimal);
    // …and exporting that re-import must be byte-identical (fixpoint).
    expect(buildCardExport(characterFromParsed(parseCard(exported)), 'v2')).toEqual(exported);
  });

  it('exports a from-scratch character without envelope residue', () => {
    const card = buildCardExport(characterFromParsed(parseCard(V1_CARD)), 'v2');
    const data = card.data as Record<string, unknown>;
    expect(data.extensions).toEqual({});
    expect(data.creatorcomment).toBe('Tavern-era metadata.');
    expect(data.name).toBe('Captain Vance');
    expect(card.spec_version).toBe('2.0');
  });

  it('supports the optional V3 export format', () => {
    const card = buildCardExport(characterFromParsed(parseCard(V2_CARD)), 'v3');
    expect(card.spec).toBe('chara_card_v3');
    expect(card.spec_version).toBe('3.0');
  });

  it('builds a filesystem-safe export filename', () => {
    const character = characterFromParsed(parseCard(V2_CARD));
    expect(cardExportFilename(character, 'v2')).toBe('lady-vivienne.card.v2.json');
    const hostile = { ...character, name: 'Réne/the *Odd* "One"   !!!' };
    expect(cardExportFilename(hostile as Character, 'v3')).toMatch(/\.card\.v3\.json$/);
    expect(cardExportFilename({ ...character, name: '   ' } as Character, 'v2')).toBe(
      'character.card.v2.json',
    );
  });
});
