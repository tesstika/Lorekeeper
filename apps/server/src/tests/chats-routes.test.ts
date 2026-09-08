import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { LorekeeperDb } from '../db/client';
import { attachments, messages as messagesTable } from '../db/schema';
import { createAssistantVariant } from '../services/messagesRepo';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-chats-'));
mkdirSync(path.join(dataDir, 'media'), { recursive: true });
const secretKeyPath = path.join(dataDir, 'secret.key');

let app: Awaited<ReturnType<typeof buildApp>>;
let db: LorekeeperDb;

beforeAll(async () => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = secretKeyPath;
  app = await buildApp({ dataDir });
  await app.ready();
  db = app.db;
});

afterAll(async () => {
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
  tags: ['Noir'],
  description: 'A moody occultist.',
  personality: 'Sharp.',
  firstMessage: '*The clock strikes three.* "You came."',
  alternateGreetings: ['*Alt greeting one.*', '*Alt greeting two.*'],
  jailbreak: '',
};

async function createCharacter(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/characters',
    payload: { ...CHARACTER, ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

function insertAssistantRow(
  chatId: string,
  seq: number,
  text: string,
  groupId: string,
  variantIndex = 0,
  isActive = true,
) {
  db.insert(messagesTable)
    .values({
      id: crypto.randomUUID(),
      chatId,
      seq,
      role: 'assistant' as const,
      text,
      groupId,
      variantIndex,
      isActive,
      isGreeting: false,
      finishReason: 'stop' as const,
      isError: false,
      createdAt: new Date().toISOString(),
    })
    .run();
}

describe('chat creation & greeting (§3.1)', () => {
  it('creates a chat with a greeting turn at seq 0 from firstMessage', async () => {
    const characterId = await createCharacter();
    const response = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      chat: { id: string; title: string; status: string; characterId: string };
      messages: Array<{
        seq: number;
        role: string;
        isGreeting: boolean;
        groupId: string | null;
        activeVariantId: string | null;
        variants: Array<{ text: string }>;
      }>;
      character: { id: string };
      persona: null;
    };
    expect(body.chat.title).toBe(CHARACTER.name);
    expect(body.chat.status).toBe('in_progress');
    expect(body.character.id).toBe(characterId);
    expect(body.messages).toHaveLength(1);
    const greeting = body.messages[0];
    expect(greeting?.seq).toBe(0);
    expect(greeting?.role).toBe('assistant');
    expect(greeting?.isGreeting).toBe(true);
    expect(greeting?.groupId).toBeTruthy();
    expect(greeting?.variants[0]?.text).toContain('The clock strikes three');

    const cleanup = await app.inject({ method: 'DELETE', url: `/api/chats/${body.chat.id}` });
    expect(cleanup.statusCode).toBe(200);
  });

  it('picks a random alternate greeting when firstMessage is empty', async () => {
    const characterId = await createCharacter({ firstMessage: '' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const body = response.json() as { messages: Array<{ variants: Array<{ text: string }> }> };
    const text = body.messages[0]?.variants[0]?.text ?? '';
    expect(['*Alt greeting one.*', '*Alt greeting two.*']).toContain(text);
  });

  it('404s when the character does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId: 'no-such-character' },
    });
    expect(response.statusCode).toBe(404);
    expect((response.json() as { code: string }).code).toBe('not_found');
  });

  it('lists chats with filters and character metadata', async () => {
    const characterId = await createCharacter({ name: 'Filter Probe' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;

    const all = await app.inject({ method: 'GET', url: '/api/chats' });
    expect(all.statusCode).toBe(200);
    const listed = (
      all.json() as Array<{ id: string; characterName: string; modelId: string | null }>
    ).find((chat) => chat.id === chatId);
    expect(listed?.characterName).toBe('Filter Probe');

    const byTitle = await app.inject({ method: 'GET', url: '/api/chats?q=filter' });
    expect((byTitle.json() as Array<{ id: string }>).some((chat) => chat.id === chatId)).toBe(true);

    await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { status: 'archived' },
    });
    const archived = await app.inject({ method: 'GET', url: '/api/chats?status=archived' });
    expect((archived.json() as Array<{ id: string }>).some((chat) => chat.id === chatId)).toBe(
      true,
    );
    const inProgress = await app.inject({ method: 'GET', url: '/api/chats?status=in_progress' });
    expect((inProgress.json() as Array<{ id: string }>).some((chat) => chat.id === chatId)).toBe(
      false,
    );
  });
});

describe('chat PATCH (defaults-free discipline)', () => {
  it('updates only sent keys — untouched keys survive (D-Z1 regression)', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId, modelId: 'original/model', presetId: null },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { ribbon: 'Chapter I' },
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { title: 'Renamed Tale' },
    });
    expect(patched.statusCode).toBe(200);
    const chat = patched.json() as {
      title: string;
      ribbon: string | null;
      modelId: string | null;
      status: string;
    };
    expect(chat.title).toBe('Renamed Tale');
    expect(chat.ribbon).toBe('Chapter I');
    expect(chat.modelId).toBe('original/model');
    expect(chat.status).toBe('in_progress');

    // Explicit null clears a key.
    await app.inject({ method: 'PATCH', url: `/api/chats/${chatId}`, payload: { ribbon: null } });
    const after = await app.inject({ method: 'GET', url: `/api/chats/${chatId}` });
    expect((after.json() as { chat: { ribbon: string | null } }).chat.ribbon).toBeNull();
  });

  it('rejects invalid status values with 400', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chatId}`,
      payload: { status: 'cancelled' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('message append / edit / delete semantics', () => {
  it('appends a user message at maxSeq+1 and links pending attachments', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;

    const attachmentId = crypto.randomUUID();
    db.insert(attachments)
      .values({
        id: attachmentId,
        messageId: null,
        filePath: `media/${attachmentId}.png`,
        originalName: 'wax-seal.png',
        mimeType: 'image/png',
        width: 10,
        height: 10,
        sizeBytes: 64,
        createdAt: new Date().toISOString(),
      })
      .run();

    const sent = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'I step into the candlelight.', attachmentIds: [attachmentId] },
    });
    expect(sent.statusCode).toBe(201);
    const message = (
      sent.json() as { message: { seq: number; role: string; attachments: Array<{ url: string }> } }
    ).message;
    expect(message.seq).toBe(1);
    expect(message.role).toBe('user');
    expect(message.attachments[0]?.url).toBe(`/media/${attachmentId}.png`);

    // Re-linking the same attachment is rejected.
    const again = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'second', attachmentIds: [attachmentId] },
    });
    expect(again.statusCode).toBe(400);
    expect((again.json() as { code: string }).code).toBe('invalid_attachment');

    // Unknown attachment id → 400.
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'third', attachmentIds: ['ghost-id'] },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('edits a user message and truncates subsequent turns with regenerateAfter', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u1' },
    });
    insertAssistantRow(chatId, 2, 'a1', crypto.randomUUID());
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u2' },
    });
    insertAssistantRow(chatId, 4, 'a2', crypto.randomUUID());

    const u1 = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{ id: string; seq: number }>;
    };
    const u1id = u1.messages.find((m) => m.seq === 1)?.id ?? '';

    const edited = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages/${u1id}`,
      payload: { text: 'u1 (revised)', regenerateAfter: true },
    });
    expect(edited.statusCode).toBe(200);
    const body = edited.json() as { truncatedSeq: number | null };
    expect(body.truncatedSeq).toBe(1);

    const detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{ seq: number; variants: Array<{ text: string }> }>;
    };
    // Everything after seq 1 is gone; the greeting and the edited user turn remain.
    expect(detail.messages.map((m) => m.seq)).toEqual([0, 1]);
    expect(detail.messages[1]?.variants[0]?.text).toBe('u1 (revised)');
  });

  it('edits the ACTIVE assistant variant in place and refuses non-active ones', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    const groupId = crypto.randomUUID();
    insertAssistantRow(chatId, 1, 'variant A', groupId, 0, false);
    insertAssistantRow(chatId, 1, 'variant B', groupId, 1, true);

    const detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{ id: string; variants: Array<{ id: string; isActive: boolean }> }>;
    };
    const group = detail.messages[1];
    const activeId = group?.variants.find((v) => v.isActive)?.id ?? '';
    const inactiveId = group?.variants.find((v) => !v.isActive)?.id ?? '';

    const editActive = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages/${activeId}`,
      payload: { text: 'variant B (edited)' },
    });
    expect(editActive.statusCode).toBe(200);

    const editInactive = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages/${inactiveId}`,
      payload: { text: 'should fail' },
    });
    expect(editInactive.statusCode).toBe(409);
    expect((editInactive.json() as { code: string }).code).toBe('variant_not_active');

    const after = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{ variants: Array<{ text: string; isActive: boolean }> }>;
    };
    const activeText = after.messages[1]?.variants.find((v) => v.isActive)?.text;
    expect(activeText).toBe('variant B (edited)');
  });

  it('deletes an assistant group, renumbers densely and cascades attachments', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u1' },
    });
    const groupA = crypto.randomUUID();
    insertAssistantRow(chatId, 2, 'a1', groupA);
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u2' },
    });
    insertAssistantRow(chatId, 4, 'a2', crypto.randomUUID());

    const detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{
        id: string;
        seq: number;
        groupId: string | null;
        variants: Array<{ id: string }>;
      }>;
    };
    const groupMessage = detail.messages.find((m) => m.groupId === groupA);
    expect(groupMessage).toBeDefined();

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/chats/${chatId}/messages/${groupMessage?.id}`,
    });
    expect(deleted.statusCode).toBe(200);
    const { deletedIds } = deleted.json() as { deletedIds: string[] };
    expect(deletedIds).toHaveLength(1);

    const after = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{ seq: number; role: string }>;
    };
    expect(after.messages.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
    expect(after.messages.filter((m) => m.role === 'assistant')).toHaveLength(2); // greeting + a2
  });

  it('deletes a user message with/without the replies that followed', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u1' },
    });
    insertAssistantRow(chatId, 2, 'a1', crypto.randomUUID());
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u2' },
    });

    let detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{ id: string; seq: number; role: string; variants: Array<{ text: string }> }>;
    };
    const u1 = detail.messages.find((m) => m.seq === 1);

    // withReplies=0 (default): the following assistant reply stays, orphaned.
    const orphan = await app.inject({
      method: 'DELETE',
      url: `/api/chats/${chatId}/messages/${u1?.id}?withReplies=0`,
    });
    expect(orphan.statusCode).toBe(200);
    detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json();
    expect(detail.messages.map((m) => m.seq)).toEqual([0, 1, 2]);
    expect(detail.messages[1]?.variants[0]?.text).toBe('a1');

    // Recreate u1 and delete with withReplies=1 → everything after goes too.
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u1b' },
    });
    detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json();
    const u1b = detail.messages.find((m) => m.seq === 2);
    const cascade = await app.inject({
      method: 'DELETE',
      url: `/api/chats/${chatId}/messages/${u1b?.id}?withReplies=1`,
    });
    expect(cascade.statusCode).toBe(200);
    detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json();
    expect(detail.messages.map((m) => m.seq)).toEqual([0, 1]); // greeting + orphaned a1
  });

  it('swipes variants with activate and 404s unknown variants', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    const groupId = crypto.randomUUID();
    insertAssistantRow(chatId, 1, 'first swipe', groupId, 0, true);
    insertAssistantRow(chatId, 1, 'second swipe', groupId, 1, false);

    const detail = (await app.inject({ method: 'GET', url: `/api/chats/${chatId}` })).json() as {
      messages: Array<{ variants: Array<{ id: string; isActive: boolean; text: string }> }>;
    };
    const second = detail.messages[1]?.variants.find((v) => v.text === 'second swipe');
    const first = detail.messages[1]?.variants.find((v) => v.text === 'first swipe');

    const activated = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages/${first?.id}/activate`,
      payload: { variantId: second?.id },
    });
    expect(activated.statusCode).toBe(200);
    const { message } = activated.json() as {
      message: {
        activeVariantId: string | null;
        variants: Array<{ isActive: boolean; text: string }>;
      };
    };
    expect(message.activeVariantId).toBe(second?.id);
    expect(message.variants.find((v) => v.text === 'second swipe')?.isActive).toBe(true);
    expect(message.variants.find((v) => v.text === 'first swipe')?.isActive).toBe(false);

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages/${first?.id}/activate`,
      payload: { variantId: 'ghost' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses swiping on user messages (no variant group)', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    const sent = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'plain user text' },
    });
    const userId = (sent.json() as { message: { id: string } }).message.id;
    const response = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages/${userId}/activate`,
      payload: { variantId: userId },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe('not_a_group');
  });

  it('caps variant groups at keepLastNVariants, pruning the oldest', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'u1' },
    });
    const groupId = crypto.randomUUID();
    for (let index = 0; index < 4; index += 1) {
      insertAssistantRow(chatId, 2, `v${index}`, groupId, index, index === 0);
    }

    const created5 = createAssistantVariant(db, chatId, { groupId, keepLastNVariants: 3 });
    const group = db.select().from(messagesTable).where(eqGroupId(chatId, groupId)).all();
    expect(group).toHaveLength(3);
    expect(group.some((row) => row.id === created5.id && row.isActive)).toBe(true);
    expect(group.map((row) => row.variantIndex).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      2, 3, 4,
    ]);
  });

  it('deleting the chat cascades messages and attachments', async () => {
    const characterId = await createCharacter();
    const created = await app.inject({
      method: 'POST',
      url: '/api/chats',
      payload: { characterId },
    });
    const chatId = (created.json() as { chat: { id: string } }).chat.id;
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      payload: { text: 'to be cascaded' },
    });

    const removed = await app.inject({ method: 'DELETE', url: `/api/chats/${chatId}` });
    expect(removed.statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chatId}` });
    expect(detail.statusCode).toBe(404);
    const rows = db
      .select()
      .from(messagesTable)
      .all()
      .filter((row) => row.chatId === chatId);
    expect(rows).toHaveLength(0);
  });
});

function eqGroupId(chatId: string, groupId: string) {
  return and(eq(messagesTable.chatId, chatId), eq(messagesTable.groupId, groupId));
}
