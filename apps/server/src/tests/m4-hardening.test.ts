import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { attachments } from '../db/schema';
import { isGenerating } from '../generation/config';
import { providerRegistry, setProviderForTesting } from '../providers';
import type { LlmProvider } from '../providers/types';
import { cleanupOrphanMedia } from '../services/attachments';
import { KeyStore } from '../services/keyStore';
import { setModelCache } from '../services/settingsRepo';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-m4-'));
mkdirSync(path.join(dataDir, 'media'), { recursive: true });
const secretKeyPath = path.join(dataDir, 'secret.key');

let app: Awaited<ReturnType<typeof buildApp>>;
let keyStore: KeyStore;
const originalProvider = providerRegistry.openrouter;

beforeAll(async () => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = secretKeyPath;
  app = await buildApp({ dataDir });
  await app.ready();
  keyStore = new KeyStore(app.db);
  keyStore.setKey('openrouter', 'sk-or-v1-m4-test-key-000');
});

afterAll(async () => {
  setProviderForTesting('openrouter', originalProvider);
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows WAL handles — best-effort cleanup.
  }
});

const CHARACTER = {
  name: 'Lady Vivienne de Valois',
  tagline: 'Victorian Occultist',
  description: 'A moody occultist with a lantern.',
  personality: 'Sharp.',
  firstMessage: '*The clock strikes three.* "You came."',
  systemExtras: 'Always answer in period prose.',
  jailbreak: 'Blood and duels are permitted in this tale.',
};

async function createCharacterAndChat(overrides: Record<string, unknown> = {}): Promise<string> {
  const character = await app.inject({
    method: 'POST',
    url: '/api/characters',
    payload: { ...CHARACTER, ...overrides },
  });
  const characterId = (character.json() as { id: string }).id;
  const chat = await app.inject({ method: 'POST', url: '/api/chats', payload: { characterId } });
  expect(chat.statusCode).toBe(201);
  return (chat.json() as { chat: { id: string } }).chat.id;
}

async function configureEngine(): Promise<void> {
  await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    payload: { globalDefaults: { providerId: 'openrouter', modelId: 'test/model' } },
  });
  setModelCache(app.db, 'openrouter', {
    fetchedAt: new Date().toISOString(),
    models: [
      { id: 'test/model', name: 'Test Model', contextLength: 32_000, inputModalities: ['text'] },
    ],
  });
}

interface PreviewBody {
  system: string;
  trailing: string | null;
  history: Array<{ role: string; content: unknown }>;
  warnings: string[];
  budget: number;
  estimatedTokens: number;
  droppedTurnsCount: number;
  providerId: string | null;
  modelId: string | null;
  modelContextLength: number | null;
}

/** Writes a media file + an attachment row; returns the relative file path. */
function insertAttachmentRow(options: { ageMs?: number; messageId?: string | null }): {
  id: string;
  filePath: string;
} {
  const id = crypto.randomUUID();
  const filePath = `media/${id}.png`;
  writeFileSync(path.join(dataDir, filePath), Buffer.from('89504e470d0a1a0a', 'hex'));
  app.db
    .insert(attachments)
    .values({
      id,
      messageId: options.messageId ?? null,
      filePath,
      originalName: `${id}.png`,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      sizeBytes: 8,
      createdAt: new Date(Date.now() - (options.ageMs ?? 0)).toISOString(),
    })
    .run();
  return { id, filePath };
}

// ---------------------------------------------------------------------------
// Prompt-preview debug endpoint (§7.1)
// ---------------------------------------------------------------------------

describe('GET /api/chats/:id/prompt-preview', () => {
  it('returns the assembled system prompt, trailing slot, history and budget math', async () => {
    await configureEngine();
    const chatId = await createCharacterAndChat();
    const send = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'I step into the candlelight.' },
    });
    expect(send.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/${chatId}/prompt-preview`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PreviewBody;

    // System slot: the rendered template with character data substituted.
    expect(body.system).toContain('Lady Vivienne de Valois');
    expect(body.system).toContain('Always answer in period prose.');
    expect(body.system).not.toContain('{{char}}');
    expect(body.system).not.toContain('{systemExtras}');

    // Trailing slot: PHI empty + jailbreak set → exactly the jailbreak, and
    // no system role leaks into the history payload.
    expect(body.trailing).toBe(CHARACTER.jailbreak);
    expect(body.history.every((m) => m.role !== 'system')).toBe(true);

    // History in wire order: greeting + the user turn.
    expect(body.history.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(body.warnings).toEqual([]);
    expect(body.budget).toBeGreaterThan(0);
    expect(body.estimatedTokens).toBeGreaterThan(0);
    expect(body.estimatedTokens).toBeLessThanOrEqual(body.budget);
    expect(body.droppedTurnsCount).toBe(0);
    expect(body.providerId).toBe('openrouter');
    expect(body.modelId).toBe('test/model');
    expect(body.modelContextLength).toBe(32_000);

    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });

  it('honors the per-chat context budget override and counts dropped turns', async () => {
    await configureEngine();
    const chatId = await createCharacterAndChat();
    // Long turns (~1.4k chars ≈ 350 estimated tokens each) so a 1024-token
    // override actually forces trimming.
    const longTurn = `${'The candle gutters as the story unwinds through the vault. '.repeat(26)}End of turn.`;
    for (const text of [longTurn, longTurn, longTurn]) {
      const send = await app.inject({
        method: 'POST',
        url: `/api/chats/${chatId}/messages`,
        payload: { text },
      });
      expect(send.statusCode).toBe(201);
    }

    // A tiny override forces trimming: the greeting anchor + the newest
    // contiguous block survive; older turns drop and are counted.
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { contextBudgetTokens: 1024 },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { contextBudgetTokens: number | null }).contextBudgetTokens).toBe(1024);

    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/${chatId}/prompt-preview`,
    });
    const body = response.json() as PreviewBody;
    expect(body.budget).toBeLessThanOrEqual(1024);
    expect(body.droppedTurnsCount).toBeGreaterThan(0);

    // Resetting the override falls back to the global default.
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { contextBudgetTokens: null },
    });
    expect((reset.json() as { contextBudgetTokens: number | null }).contextBudgetTokens).toBeNull();
    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });

  it('redacts inline base64 images to size placeholders', async () => {
    await configureEngine();
    const chatId = await createCharacterAndChat();
    const attachment = insertAttachmentRow({});
    const send = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'What do you see?', attachmentIds: [attachment.id] },
    });
    expect(send.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/${chatId}/prompt-preview`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PreviewBody;
    const finalUser = body.history.at(-1);
    expect(Array.isArray(finalUser?.content)).toBe(true);
    const parts = finalUser?.content as Array<{
      type: string;
      text?: string;
      imageUrl?: { url: string };
    }>;
    expect(parts[0]?.type).toBe('text'); // text part first (§4.2)
    const imagePart = parts.find((part) => part.type === 'image_url');
    expect(imagePart?.imageUrl?.url).toMatch(
      /^data:image\/png;base64,<inline image omitted — \d[\d,]* bytes>$/,
    );
    // No real base64 payload ships in the debug response.
    expect(response.body).not.toContain('AAAA');
    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });

  it('404s for unknown chats and 400s with no_model_configured when unset', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/chats/nope/prompt-preview' });
    expect(missing.statusCode).toBe(404);

    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { globalDefaults: { providerId: null, modelId: null } },
    });
    const chatId = await createCharacterAndChat();
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/${chatId}/prompt-preview`,
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe('no_model_configured');
    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
    await configureEngine();
  });
});

// ---------------------------------------------------------------------------
// Mutation guards during an active generation (D-T2)
// ---------------------------------------------------------------------------

describe('message mutations during active generation (D-T2)', () => {
  it('409s append/edit/delete while a generation is live, then recovers', async () => {
    await configureEngine();
    const chatId = await createCharacterAndChat();

    // The executor assigns this synchronously — definite assignment is safe.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const blockedProvider: LlmProvider = {
      ...originalProvider,
      id: 'openrouter',
      label: 'Blocked',
      baseUrl: 'mock://test',
      async *streamChat(_request, _apiKey, signal) {
        yield { type: 'delta', text: 'writing…' };
        await gate;
        yield signal.aborted
          ? { type: 'done', finishReason: 'aborted' }
          : { type: 'done', finishReason: 'stop' };
      },
    };
    setProviderForTesting('openrouter', blockedProvider);

    const generation = app.inject({ method: 'POST', url: `/api/chats/${chatId}/generate` });
    await vi.waitFor(() => expect(isGenerating(chatId)).toBe(true));

    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chatId}` });
    const messages = (detail.json() as { messages: Array<{ id: string }> }).messages;
    expect(messages.length).toBeGreaterThan(0);
    const greetingId = messages[0]?.id ?? '';

    const append = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'hasty message' },
    });
    expect(append.statusCode).toBe(409);
    expect(append.json()).toMatchObject({ code: 'generation_in_progress' });

    const edit = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages/${greetingId}`,
      payload: { text: 'rushed edit' },
    });
    expect(edit.statusCode).toBe(409);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/chats/${chatId}/messages/${greetingId}`,
    });
    expect(remove.statusCode).toBe(409);

    // The in-flight generation is unaffected and completes once the gate opens.
    releaseGate();
    const streamResponse = await generation;
    expect(streamResponse.statusCode).toBe(200);

    // After completion the same mutations succeed again.
    const appendOk = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'patient message' },
    });
    expect(appendOk.statusCode).toBe(201);
    expect(isGenerating(chatId)).toBe(false);
    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });
});

// ---------------------------------------------------------------------------
// Attachment orphan GC sweep (D-C1 / D-T4)
// ---------------------------------------------------------------------------

describe('cleanupOrphanMedia (attachment GC)', () => {
  it('prunes stale pending rows + files, keeps referenced and recent data', async () => {
    // Character whose avatar references a media file (protected reference).
    const character = await app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { name: 'Avatar Keeper' },
    });
    const characterId = (character.json() as { id: string }).id;
    const avatarFile = 'media/avatar-kept.png';
    writeFileSync(path.join(dataDir, avatarFile), Buffer.from('89504e470d0a1a0a', 'hex'));
    await app.inject({
      method: 'PATCH',
      url: `/api/characters/${characterId}`,
      payload: { avatarPath: avatarFile },
    });

    // Chat + user message so a LINKED attachment has a home.
    const chat = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (chat.json() as { chat: { id: string } }).chat.id;
    const sent = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'linked message' },
    });
    const linkedMessageId = (sent.json() as { message: { id: string } }).message.id;

    // 1. Stale pending draft (messageId NULL, 25 h) → row + file pruned.
    const stale = insertAttachmentRow({ ageMs: 25 * 60 * 60 * 1000 });
    // 2. Fresh pending draft (1 min) → survives the 24 h rule.
    const fresh = insertAttachmentRow({ ageMs: 60 * 1000 });
    // 3. Message-linked attachment (old) → always survives.
    const linked = insertAttachmentRow({
      ageMs: 48 * 60 * 60 * 1000,
      messageId: linkedMessageId,
    });
    // 4. Stray file with no DB reference → swept.
    const strayFile = 'media/stray.png';
    writeFileSync(path.join(dataDir, strayFile), Buffer.from('89504e470d0a1a0a', 'hex'));

    const result = cleanupOrphanMedia(app.db, dataDir);

    expect(result.prunedRows).toBe(1);
    // ≥2: the stale draft file + the stray file. Earlier tests in this shared
    // data dir deleted chats whose attachment rows cascaded — their files are
    // legitimately unreferenced by now, so the sweep may collect them too.
    expect(result.deletedFiles).toBeGreaterThanOrEqual(2);
    expect(existsSync(path.join(dataDir, stale.filePath))).toBe(false);
    expect(existsSync(path.join(dataDir, fresh.filePath))).toBe(true);
    expect(existsSync(path.join(dataDir, linked.filePath))).toBe(true);
    expect(existsSync(path.join(dataDir, strayFile))).toBe(false);
    expect(existsSync(path.join(dataDir, avatarFile))).toBe(true);
    // The pruned row is really gone.
    expect(
      app.db.select().from(attachments).where(eq(attachments.id, stale.id)).all(),
    ).toHaveLength(0);

    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });
});

// ---------------------------------------------------------------------------
// Persona overrides — detail payload, prompt injection, explicit none
// ---------------------------------------------------------------------------

describe('persona overrides', () => {
  async function createPersona(overrides: Record<string, unknown> = {}): Promise<string> {
    const persona = await app.inject({
      method: 'POST',
      url: '/api/personas',
      payload: {
        name: 'Mike',
        description: 'A quiet archivist with ink-stained hands.',
        avatarPath: 'media/mike.png',
        ...overrides,
      },
    });
    expect(persona.statusCode).toBe(201);
    return (persona.json() as { id: string }).id;
  }

  async function createChatWithPersona(personaId: string | null): Promise<string> {
    const character = await app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { name: 'Persona Host' },
    });
    const characterId = (character.json() as { id: string }).id;
    const chat = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: personaId ? { characterId, personaId } : { characterId },
    });
    expect(chat.statusCode).toBe(201);
    return (chat.json() as { chat: { id: string } }).chat.id;
  }

  it('returns the effective persona (name/description/avatarPath) in the chat detail', async () => {
    const personaId = await createPersona();
    const chatId = await createChatWithPersona(personaId);

    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chatId}` });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.chat.personaId).toBe(personaId);
    expect(body.chat.personaNone).toBe(false);
    expect(body.persona).toMatchObject({
      id: personaId,
      name: 'Mike',
      description: 'A quiet archivist with ink-stained hands.',
      avatarPath: 'media/mike.png',
    });

    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });

  it('injects the persona name and description into prompt assembly', async () => {
    await configureEngine();
    const personaId = await createPersona();
    const chatId = await createChatWithPersona(personaId);

    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/${chatId}/prompt-preview`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PreviewBody;
    expect(body.system).toContain('<Persona>');
    expect(body.system).toContain('Mike');
    expect(body.system).toContain('A quiet archivist with ink-stained hands.');

    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });

  it('personaNone suppresses both the chat persona and the global default', async () => {
    await configureEngine();
    const personaId = await createPersona({ avatarPath: null });
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { globalDefaults: { personaId } },
    });
    // No chat-level persona → the global default (Mike) is effective…
    const chatId = await createChatWithPersona(null);
    const before = await app.inject({ method: 'GET', url: `/api/chats/${chatId}/prompt-preview` });
    expect((before.json() as PreviewBody).system).toContain('Mike');

    // …until the chat opts out explicitly.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { personaId: null, personaNone: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().personaNone).toBe(true);

    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chatId}` });
    expect(detail.json().persona).toBeNull();
    const after = await app.inject({ method: 'GET', url: `/api/chats/${chatId}/prompt-preview` });
    const body = after.json() as PreviewBody;
    expect(body.system).not.toContain('Mike');
    expect(body.system).not.toContain('A quiet archivist');
    expect(body.system).toContain('the user');

    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { globalDefaults: { personaId: null } },
    });
  });

  it('rejects an empty-string personaId with a validation error (never an FK 500)', async () => {
    const chatId = await createChatWithPersona(null);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { personaId: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_error');
    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });

  it('PATCHes without persona keys leave the persona override untouched', async () => {
    const personaId = await createPersona();
    const chatId = await createChatWithPersona(personaId);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { title: 'Renamed Chronicle' },
    });
    expect(patched.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chatId}` });
    expect(detail.json().chat.personaId).toBe(personaId);
    expect(detail.json().persona).toMatchObject({ id: personaId, name: 'Mike' });

    await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
  });
});
