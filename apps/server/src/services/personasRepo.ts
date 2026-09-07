import type { Persona, PersonaCreateInput, PersonaPatch } from '@lorekeeper/shared';
import { eq, sql } from 'drizzle-orm';
import type { LorekeeperDb } from '../db/client';
import { personas, settings } from '../db/schema';

function toPersona(row: typeof personas.$inferSelect): Persona {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatarPath: row.avatarPath,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listPersonas(db: LorekeeperDb): Persona[] {
  const rows = db
    .select()
    .from(personas)
    .orderBy(sql`${personas.isDefault} DESC`, personas.createdAt)
    .all();
  return rows.map(toPersona);
}

export function getPersona(db: LorekeeperDb, id: string): Persona | null {
  const row = db.select().from(personas).where(eq(personas.id, id)).all()[0];
  return row ? toPersona(row) : null;
}

/** Single-default invariant (mirrors presetsRepo): enabling one persona disables the rest. */
export function createPersona(db: LorekeeperDb, input: PersonaCreateInput): Persona {
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    if (input.isDefault) {
      tx.update(personas).set({ isDefault: false }).run();
    }
    const row = tx
      .insert(personas)
      .values({ id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now })
      .returning()
      .all()[0];
    if (!row) throw new Error('Persona insert returned no row');
    return toPersona(row);
  });
}

/** Partial merge of a defaults-free patch — only sent keys change. */
export function updatePersona(db: LorekeeperDb, id: string, patch: PersonaPatch): Persona | null {
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const existing = tx.select().from(personas).where(eq(personas.id, id)).all();
    if (!existing[0]) return null;
    if (patch.isDefault === true) {
      tx.update(personas).set({ isDefault: false }).run();
    }
    const updated = tx
      .update(personas)
      .set({ ...patch, updatedAt: now })
      .where(eq(personas.id, id))
      .returning()
      .all()[0];
    if (!updated) throw new Error('Persona update returned no row');
    return toPersona(updated);
  });
}

/**
 * Deletes a persona and clears a dangling `globalDefaults.personaId`
 * reference (mirrors presetsRepo.deletePreset's transactional dangling-clear).
 */
export function deletePersona(db: LorekeeperDb, id: string): boolean {
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const removed = tx.delete(personas).where(eq(personas.id, id)).returning().all();
    if (removed.length === 0) return false;
    const current = tx.select().from(settings).where(eq(settings.key, 'globalDefaults')).all()[0];
    const raw = current?.value;
    if (
      raw !== null &&
      typeof raw === 'object' &&
      (raw as { personaId?: unknown }).personaId === id
    ) {
      const next = { ...(raw as Record<string, unknown>), personaId: null };
      tx.insert(settings)
        .values({ key: 'globalDefaults', value: next, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: now } })
        .run();
    }
    return true;
  });
}
