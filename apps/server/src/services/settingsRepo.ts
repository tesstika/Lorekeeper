import {
  type ApiKeys,
  apiKeysSchema,
  type ComposerSettings,
  composerSchema,
  type GlobalDefaults,
  globalDefaultsSchema,
  type KeyEnvelope,
  type ModelCache,
  modelCacheSchema,
  type PromptTemplate,
  type ProviderId,
  promptTemplateSchema,
} from '@lorekeeper/shared';
import { eq } from 'drizzle-orm';
import type { LorekeeperDb } from '../db/client';
import { settings } from '../db/schema';

export type ProviderTestRecord = {
  status: 'connected' | 'error';
  latencyMs: number | null;
  code: string | null;
  message: string | null;
  testedAt: string;
};

export function getSettingRaw(db: LorekeeperDb, key: string): unknown {
  const rows = db.select().from(settings).where(eq(settings.key, key)).all();
  return rows[0]?.value ?? null;
}

export function setSettingRaw(db: LorekeeperDb, key: string, value: unknown): void {
  const updatedAt = new Date().toISOString();
  db.insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run();
}

export function deleteSettingRaw(db: LorekeeperDb, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}

/** Parses a stored JSON value, falling back to the schema's defaults when the row is missing or corrupt. */
function getSettingWith<T>(
  db: LorekeeperDb,
  key: string,
  parse: (value: unknown) => T,
  fallback: () => T,
): T {
  const raw = getSettingRaw(db, key);
  if (raw === null) return fallback();
  try {
    return parse(raw);
  } catch {
    return fallback();
  }
}

// -- apiKeys ---------------------------------------------------------------

export function getApiKeys(db: LorekeeperDb): ApiKeys {
  return getSettingWith(
    db,
    'apiKeys',
    (raw) => apiKeysSchema.parse(raw),
    () => apiKeysSchema.parse({}),
  );
}

export function setApiKeyEnvelope(
  db: LorekeeperDb,
  providerId: ProviderId,
  envelope: KeyEnvelope | null,
): ApiKeys {
  const keys = getApiKeys(db);
  const next: ApiKeys = { ...keys, [providerId]: envelope };
  setSettingRaw(db, 'apiKeys', next);
  return next;
}

// -- globalDefaults / promptTemplate / composer ------------------------------

export function getGlobalDefaults(db: LorekeeperDb): GlobalDefaults {
  return getSettingWith(
    db,
    'globalDefaults',
    (raw) => globalDefaultsSchema.parse(raw),
    () => globalDefaultsSchema.parse({}),
  );
}

export function getPromptTemplate(db: LorekeeperDb): PromptTemplate {
  return getSettingWith(
    db,
    'promptTemplate',
    (raw) => promptTemplateSchema.parse(raw),
    () => promptTemplateSchema.parse({}),
  );
}

export function getComposer(db: LorekeeperDb): ComposerSettings {
  return getSettingWith(
    db,
    'composer',
    (raw) => composerSchema.parse(raw),
    () => composerSchema.parse({}),
  );
}

// -- model cache (`modelCache:<providerId>`) ---------------------------------

export function getModelCache(db: LorekeeperDb, providerId: ProviderId): ModelCache | null {
  return getSettingWith(
    db,
    `modelCache:${providerId}`,
    (raw) => modelCacheSchema.parse(raw),
    () => null,
  );
}

export function setModelCache(db: LorekeeperDb, providerId: ProviderId, cache: ModelCache): void {
  setSettingRaw(db, `modelCache:${providerId}`, cache);
}

// -- last connection test (`providerTest:<providerId>`) -----------------------

export function getProviderTest(
  db: LorekeeperDb,
  providerId: ProviderId,
): ProviderTestRecord | null {
  return getSettingWith(
    db,
    `providerTest:${providerId}`,
    (raw) => raw as ProviderTestRecord,
    () => null,
  );
}

export function setProviderTest(
  db: LorekeeperDb,
  providerId: ProviderId,
  record: ProviderTestRecord,
): void {
  setSettingRaw(db, `providerTest:${providerId}`, record);
}
