import type { Preset, PresetInput, PresetPatch } from '@lorekeeper/shared';
import { eq } from 'drizzle-orm';
import type { LorekeeperDb } from '../db/client';
import { presets, settings } from '../db/schema';
import { getSettingRaw, setSettingRaw } from './settingsRepo';

const SEED_MARKER = 'presetSeed:v1';
export const DEFAULT_PRESET_NAME = 'Default Sanctum';

function toPreset(row: typeof presets.$inferSelect): Preset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    temperature: row.temperature,
    topP: row.topP,
    topK: row.topK,
    maxTokens: row.maxTokens,
    frequencyPenalty: row.frequencyPenalty,
    presencePenalty: row.presencePenalty,
    repetitionPenalty: row.repetitionPenalty,
    stopSequences: row.stopSequences,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listPresets(db: LorekeeperDb): Preset[] {
  const rows = db.select().from(presets).orderBy(presets.createdAt).all();
  return rows.map(toPreset);
}

export function getPreset(db: LorekeeperDb, id: string): Preset | null {
  const row = db.select().from(presets).where(eq(presets.id, id)).all()[0];
  return row ? toPreset(row) : null;
}

/** Enforces the single-default invariant: enabling one preset disables the rest. */
export function createPreset(db: LorekeeperDb, input: PresetInput): Preset {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return db.transaction((tx) => {
    if (input.isDefault) {
      tx.update(presets).set({ isDefault: false }).run();
    }
    const row = tx
      .insert(presets)
      .values({
        id,
        name: input.name,
        description: input.description,
        temperature: input.temperature,
        topP: input.topP,
        topK: input.topK,
        maxTokens: input.maxTokens,
        frequencyPenalty: input.frequencyPenalty,
        presencePenalty: input.presencePenalty,
        repetitionPenalty: input.repetitionPenalty,
        stopSequences: input.stopSequences,
        isDefault: input.isDefault,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()[0];
    if (!row) throw new Error('Preset insert returned no row');
    return toPreset(row);
  });
}

export function updatePreset(db: LorekeeperDb, id: string, patch: PresetPatch): Preset | null {
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const existing = tx.select().from(presets).where(eq(presets.id, id)).all();
    if (!existing[0]) return null;
    if (patch.isDefault === true) {
      tx.update(presets).set({ isDefault: false }).run();
    }
    const updated = tx
      .update(presets)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.temperature !== undefined ? { temperature: patch.temperature } : {}),
        ...(patch.topP !== undefined ? { topP: patch.topP } : {}),
        ...(patch.topK !== undefined ? { topK: patch.topK } : {}),
        ...(patch.maxTokens !== undefined ? { maxTokens: patch.maxTokens } : {}),
        ...(patch.frequencyPenalty !== undefined
          ? { frequencyPenalty: patch.frequencyPenalty }
          : {}),
        ...(patch.presencePenalty !== undefined ? { presencePenalty: patch.presencePenalty } : {}),
        ...(patch.repetitionPenalty !== undefined
          ? { repetitionPenalty: patch.repetitionPenalty }
          : {}),
        ...(patch.stopSequences !== undefined ? { stopSequences: patch.stopSequences } : {}),
        ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
        updatedAt: now,
      })
      .where(eq(presets.id, id))
      .returning()
      .all()[0];
    if (!updated) throw new Error('Preset update returned no row');
    return toPreset(updated);
  });
}

/** Deletes a preset and clears a dangling `globalDefaults.presetId` reference. */
export function deletePreset(db: LorekeeperDb, id: string): boolean {
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const removed = tx.delete(presets).where(eq(presets.id, id)).returning().all();
    if (removed.length === 0) return false;
    const current = tx.select().from(settings).where(eq(settings.key, 'globalDefaults')).all()[0];
    const raw = current?.value;
    if (
      raw !== null &&
      typeof raw === 'object' &&
      (raw as { presetId?: unknown }).presetId === id
    ) {
      const next = { ...(raw as Record<string, unknown>), presetId: null };
      tx.insert(settings)
        .values({ key: 'globalDefaults', value: next, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: now } })
        .run();
    }
    return true;
  });
}

/**
 * Seeds the default preset exactly once (settings marker — deleting it later
 * in the UI must not resurrect it on reboot).
 */
export function ensureSeedPresets(db: LorekeeperDb): void {
  if (getSettingRaw(db, SEED_MARKER) === true) return;
  const existing = db.select({ id: presets.id }).from(presets).all();
  if (existing.length === 0) {
    const now = new Date().toISOString();
    db.insert(presets)
      .values({
        id: crypto.randomUUID(),
        name: DEFAULT_PRESET_NAME,
        description: 'Balanced baseline for narrative roleplay.',
        temperature: 0.85,
        topP: 0.92,
        maxTokens: 4096,
        frequencyPenalty: 0,
        presencePenalty: 0,
        stopSequences: [],
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  setSettingRaw(db, SEED_MARKER, true);
}
