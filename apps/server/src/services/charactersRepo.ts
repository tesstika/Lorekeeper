import type { Character, CharacterCreateInput, CharacterPatch } from '@lorekeeper/shared';
import { eq, sql } from 'drizzle-orm';
import type { LorekeeperDb } from '../db/client';
import { characters, chats } from '../db/schema';

function toCharacter(row: typeof characters.$inferSelect): Character {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    tags: row.tags,
    avatarPath: row.avatarPath,
    description: row.description,
    creatorNotes: row.creatorNotes,
    extensions: row.extensions,
    personality: row.personality,
    behavior: row.behavior,
    communicationStyle: row.communicationStyle,
    likes: row.likes,
    dislikes: row.dislikes,
    backstory: row.backstory,
    scenario: row.scenario,
    exampleDialogue: row.exampleDialogue,
    firstMessage: row.firstMessage,
    alternateGreetings: row.alternateGreetings,
    systemExtras: row.systemExtras,
    jailbreak: row.jailbreak,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listCharacters(db: LorekeeperDb): Character[] {
  const rows = db.select().from(characters).orderBy(sql`${characters.updatedAt} DESC`).all();
  return rows.map(toCharacter);
}

export function getCharacter(db: LorekeeperDb, id: string): Character | null {
  const row = db.select().from(characters).where(eq(characters.id, id)).all()[0];
  return row ? toCharacter(row) : null;
}

export function createCharacter(db: LorekeeperDb, input: CharacterCreateInput): Character {
  const now = new Date().toISOString();
  const row = db
    .insert(characters)
    .values({ id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now })
    .returning()
    .all()[0];
  if (!row) throw new Error('Character insert returned no row');
  return toCharacter(row);
}

/** Partial merge of a defaults-free patch — only sent keys change. */
export function updateCharacter(
  db: LorekeeperDb,
  id: string,
  patch: CharacterPatch,
): Character | null {
  const now = new Date().toISOString();
  const row = db
    .update(characters)
    .set({ ...patch, updatedAt: now })
    .where(eq(characters.id, id))
    .returning()
    .all()[0];
  return row ? toCharacter(row) : null;
}

export type CharacterDeleteResult = { ok: true } | { ok: false; chatCount: number };

/**
 * DELETE is blocked while chats reference the character (plan §3.2, §7.1):
 * the client surfaces `character_in_use` + chatCount; `force` cascades the
 * chats (messages/attachments follow their FKs) inside one transaction.
 */
export function deleteCharacter(
  db: LorekeeperDb,
  id: string,
  force = false,
): CharacterDeleteResult {
  return db.transaction((tx): CharacterDeleteResult => {
    const countRow = tx
      .select({ count: sql<number>`count(*)` })
      .from(chats)
      .where(eq(chats.characterId, id))
      .all()[0];
    const chatCount = countRow?.count ?? 0;
    if (chatCount > 0 && !force) {
      return { ok: false, chatCount };
    }
    if (chatCount > 0) {
      tx.delete(chats).where(eq(chats.characterId, id)).run();
    }
    const removed = tx.delete(characters).where(eq(characters.id, id)).returning().all();
    if (removed.length === 0) return { ok: false, chatCount: 0 };
    return { ok: true };
  });
}
