import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-chars-'));
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ dataDir });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows may briefly hold WAL handles after close — best-effort cleanup.
  }
});

const V2_CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Imported Sage',
    description: 'An imported scholar.',
    personality: 'Patient',
    scenario: 'A dim library.',
    first_mes: '*Adjusts spectacles.*',
    mes_example: '<START>\n{{user}}: Hi\n{{char}}: "Greetings."',
    creator_notes: 'From the archive.',
    system_prompt: 'Stay scholarly.',
    post_history_instructions: 'Never mention being an AI.',
    alternate_greetings: ['*Nods.*'],
    character_book: { name: 'Archive', entries: [] },
    tags: ['Fantasy'],
    creator: 'Testika',
    character_version: '2.1',
    extensions: { risu: { locale: 'en' } },
  },
};

async function createCharacter(overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/characters',
    payload: { name: 'Test Character', tagline: 'A fixture', tags: ['Noir'], ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; [key: string]: unknown };
}

function insertChat(characterId: string, title: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  app.sqlite
    .prepare(
      `INSERT INTO chats (id, character_id, title, status, last_message_at, created_at)
       VALUES (?, ?, ?, 'in_progress', ?, ?)`,
    )
    .run(id, characterId, title, now, now);
  return id;
}

describe('character CRUD', () => {
  it('creates, lists and fetches a character', async () => {
    const created = await createCharacter({ name: 'Vivienne de Valois' });
    expect(created).toMatchObject({
      name: 'Vivienne de Valois',
      tagline: 'A fixture',
      tags: ['Noir'],
      description: '',
      jailbreak: '',
      extensions: {},
    });

    const list = await app.inject({ method: 'GET', url: '/api/characters' });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((c: { name: string }) => c.name)).toContain('Vivienne de Valois');

    const one = await app.inject({ method: 'GET', url: `/api/characters/${created.id}` });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: created.id });

    const missing = await app.inject({ method: 'GET', url: '/api/characters/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('validates character input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { name: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_error');
  });

  it('PATCH merges only sent keys — untouched keys survive (defaults-free patch)', async () => {
    const character = await createCharacter({
      name: 'Patch Target',
      tagline: 'Original tagline',
      tags: ['Original'],
      personality: 'Original personality',
      firstMessage: 'Original greeting',
      jailbreak: 'Original jailbreak',
      alternateGreetings: ['Original alternate'],
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/characters/${character.id}`,
      payload: { tagline: 'New tagline' },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json();
    expect(body.tagline).toBe('New tagline');
    // Untouched keys must NOT be clobbered by schema defaults (M1 §4.2 lesson).
    expect(body.name).toBe('Patch Target');
    expect(body.tags).toEqual(['Original']);
    expect(body.personality).toBe('Original personality');
    expect(body.firstMessage).toBe('Original greeting');
    expect(body.jailbreak).toBe('Original jailbreak');
    expect(body.alternateGreetings).toEqual(['Original alternate']);
    expect(body.description).toBe('');

    // A second partial patch keeps both edits.
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/characters/${character.id}`,
      payload: { personality: 'New personality' },
    });
    expect(second.json()).toMatchObject({
      tagline: 'New tagline',
      personality: 'New personality',
      name: 'Patch Target',
    });
  });

  it('PATCH can set nullable keys back to null explicitly', async () => {
    const character = await createCharacter();
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/characters/${character.id}`,
      payload: { tagline: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().tagline).toBeNull();
  });

  it('delete is blocked while chats reference the character, then forces', async () => {
    const character = await createCharacter({ name: 'In Use' });
    const chatId = insertChat(character.id, 'Blocked Tale');
    const chatId2 = insertChat(character.id, 'Blocked Tale 2');

    const blocked = await app.inject({ method: 'DELETE', url: `/api/characters/${character.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      code: 'character_in_use',
      chatCount: 2,
      message: expect.stringContaining('2 chats'),
    });
    // The character and both chats still exist.
    expect(
      (await app.inject({ method: 'GET', url: `/api/characters/${character.id}` })).statusCode,
    ).toBe(200);

    const forced = await app.inject({
      method: 'DELETE',
      url: `/api/characters/${character.id}?force=1`,
    });
    expect(forced.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/api/characters/${character.id}` })).statusCode,
    ).toBe(404);
    const chat = app.sqlite
      .query<{ id: string }, [string]>('SELECT id FROM chats WHERE id = ?')
      .get(chatId);
    expect(chat).toBeNull();
    void chatId2;
  });

  it('deletes an unused character directly', async () => {
    const character = await createCharacter({ name: 'Doomed' });
    const removed = await app.inject({ method: 'DELETE', url: `/api/characters/${character.id}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });
  });
});

describe('card import/export routes', () => {
  it('imports a V2 card with lossless metadata', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: V2_CARD,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.detectedFormat).toBe('v2');
    expect(body.character).toMatchObject({
      name: 'Imported Sage',
      description: 'An imported scholar.',
      firstMessage: '*Adjusts spectacles.*',
      systemExtras: 'Stay scholarly.',
      jailbreak: 'Never mention being an AI.',
      alternateGreetings: ['*Nods.*'],
      tags: ['Fantasy'],
    });
    const env = body.character.extensions.lorekeeperCard;
    expect(env.fields).toMatchObject({
      creator: 'Testika',
      character_version: '2.1',
      character_book: { name: 'Archive' },
    });
    expect(env.extensions).toEqual({ risu: { locale: 'en' } });

    // Export → same V2 card content.
    const exported = await app.inject({
      method: 'GET',
      url: `/api/characters/${body.character.id}/export`,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toContain(
      'attachment; filename="imported-sage.card.v2.json"',
    );
    expect(exported.headers['content-type']).toContain('application/json');
    const card = exported.json();
    expect(card.spec).toBe('chara_card_v2');
    expect(card.spec_version).toBe('2.0');
    expect(card.data).toMatchObject({
      name: 'Imported Sage',
      creator: 'Testika',
      character_version: '2.1',
      post_history_instructions: 'Never mention being an AI.',
    });
    expect(card.data.character_book).toEqual({ name: 'Archive', entries: [] });
    expect(card.data.extensions).toEqual({ risu: { locale: 'en' } });

    // Round-trip: re-import the export → same character fields.
    const reimport = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: card,
    });
    expect(reimport.json().character).toMatchObject({
      name: 'Imported Sage',
      jailbreak: 'Never mention being an AI.',
      creatorNotes: 'From the archive.',
    });
  });

  it('imports a V3 card and detects the format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
          name: 'V3 Wanderer',
          description: 'V3 imports work.',
          nickname: 'Wander',
          assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
          group_only_greetings: ['Group greeting.'],
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.detectedFormat).toBe('v3');
    expect(body.character.extensions.lorekeeperCard.fields).toMatchObject({
      nickname: 'Wander',
      assets: [{ type: 'icon' }],
      group_only_greetings: ['Group greeting.'],
    });

    // Optional V3 export format.
    const exported = await app.inject({
      method: 'GET',
      url: `/api/characters/${body.character.id}/export?format=v3`,
    });
    expect(exported.json().spec).toBe('chara_card_v3');
    expect(exported.headers['content-disposition']).toContain('.card.v3.json');
  });

  it('imports a legacy V1 flat card', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: {
        name: 'Tavern Classic',
        description: 'Old-style flat card.',
        personality: 'Salty',
        scenario: 'Dockside.',
        first_mes: '*Spits overboard.*',
        mes_example: 'Example.',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().detectedFormat).toBe('v1');
    expect(response.json().character).toMatchObject({
      name: 'Tavern Classic',
      firstMessage: '*Spits overboard.*',
      exampleDialogue: 'Example.',
    });
  });

  it("accepts a legal card body larger than Fastify's old 1 MiB default bodyLimit", async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Lore-Heavy Sage',
          description: 'A'.repeat(200_000),
          personality: 'B'.repeat(200_000),
          backstory: 'C'.repeat(200_000),
          scenario: 'D'.repeat(200_000),
          first_mes: 'E'.repeat(200_000),
          mes_example: 'F'.repeat(200_000),
        },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().character).toMatchObject({ name: 'Lore-Heavy Sage' });
  });

  it('rejects oversized card fields with a clean 400 and persists nothing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Oversized',
          description: 'A'.repeat(200_001),
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_card');
    expect(response.json().message).toContain('field limits');
    // The half-persisted-import failure mode (insert succeeded, response
    // serialization failed) must not happen — no row exists.
    const list = await app.inject({ method: 'GET', url: '/api/characters' });
    expect(list.json().some((c: { name: string }) => c.name === 'Oversized')).toBe(false);
  });

  it('rejects invalid cards with a 400 invalid_card envelope', async () => {
    const noName = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: { description: 'missing name' },
    });
    expect(noName.statusCode).toBe(400);
    expect(noName.json().code).toBe('invalid_card');

    const badSpec = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: { spec: 'chara_card_v9', data: { name: 'x' } },
    });
    expect(badSpec.statusCode).toBe(400);
    expect(badSpec.json().code).toBe('invalid_card');

    const nonObject = await app.inject({
      method: 'POST',
      url: '/api/characters/import',
      payload: ['not', 'an', 'object'],
    });
    expect(nonObject.statusCode).toBe(400);
  });

  it('404s when exporting a missing character', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/characters/nope/export' });
    expect(response.statusCode).toBe(404);
  });
});

describe('personas', () => {
  it('creates personas and enforces the single-default invariant', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/personas',
      payload: { name: 'Player', description: 'The chronicler.', isDefault: true },
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id;
    expect(first.json().isDefault).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/api/personas',
      payload: { name: 'Rival', isDefault: true },
    });
    expect(second.statusCode).toBe(201);
    const secondId = second.json().id;

    const list = await app.inject({ method: 'GET', url: '/api/personas' });
    const defaults = list.json().filter((p: { isDefault: boolean }) => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(secondId);

    // PUT default flips the invariant.
    const flipped = await app.inject({ method: 'PUT', url: `/api/personas/${firstId}/default` });
    expect(flipped.statusCode).toBe(200);
    expect(flipped.json().persona).toMatchObject({ id: firstId, isDefault: true });
    const afterFlip = await app.inject({ method: 'GET', url: '/api/personas' });
    const defaultsAfter = afterFlip.json().filter((p: { isDefault: boolean }) => p.isDefault);
    expect(defaultsAfter).toHaveLength(1);
    expect(defaultsAfter[0]?.id).toBe(firstId);
  });

  it('PATCH is defaults-free — untouched keys survive', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/personas',
      payload: { name: 'Editable', description: 'Original description', isDefault: false },
    });
    const id = created.json().id;
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/personas/${id}`,
      payload: { description: 'New description' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      name: 'Editable',
      description: 'New description',
      isDefault: false,
      avatarPath: null,
    });

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/personas/nope',
      payload: { description: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('deleting the persona referenced by globalDefaults clears it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/personas',
      payload: { name: 'Dangling', isDefault: false },
    });
    const id = created.json().id;
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { globalDefaults: { personaId: id } },
    });
    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.json().globalDefaults.personaId).toBe(id);

    const removed = await app.inject({ method: 'DELETE', url: `/api/personas/${id}` });
    expect(removed.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(after.json().globalDefaults.personaId).toBeNull();
  });

  it('404s unknown persona ids', async () => {
    const get = await app.inject({ method: 'GET', url: '/api/personas/nope' });
    const del = await app.inject({ method: 'DELETE', url: '/api/personas/nope' });
    const def = await app.inject({ method: 'PUT', url: '/api/personas/nope/default' });
    expect([get.statusCode, del.statusCode, def.statusCode]).toEqual([404, 404, 404]);
  });
});

describe('avatar attachments', () => {
  const PNG_1X1 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
  ]);

  function multipart(
    field: string,
    filename: string,
    buffer: Buffer,
  ): { payload: Buffer; headers: Record<string, string> } {
    const boundary = '----lorekeepertestboundary';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      payload: Buffer.concat([head, buffer, tail]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  it('uploads an avatar image and serves it back from /media', async () => {
    const { payload, headers } = multipart('file', 'portrait.png', PNG_1X1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      payload,
      headers,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.mimeType).toBe('image/png');
    expect(body.width).toBe(1);
    expect(body.height).toBe(1);
    expect(body.originalName).toBe('portrait.png');
    expect(body.url).toMatch(/^\/media\/[0-9a-f-]+\.png$/);

    // The stored file exists and the static mount serves the exact bytes.
    const storedPath = path.join(dataDir, body.url.replace('/media/', 'media/'));
    expect(readFileSync(storedPath).equals(PNG_1X1)).toBe(true);
    const served = await app.inject({ method: 'GET', url: body.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(PNG_1X1)).toBe(true);
  });

  it('rejects non-image payloads via magic-byte sniffing', async () => {
    const { payload, headers } = multipart('file', 'evil.exe', Buffer.from('MZ不以图像开头'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      payload,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('unsupported_media_type');
  });

  it('rejects images larger than the configured composer limit with 413', async () => {
    const oversize = Buffer.concat([PNG_1X1, Buffer.alloc(8 * 1024 * 1024 + 1)]);
    const { payload, headers } = multipart('file', 'big.png', oversize);
    const response = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      payload,
      headers,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('file_too_large');
  });

  it('rejects requests without a file part', async () => {
    const boundary = '----lorekeepertestboundary';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('missing_file');
  });
});
