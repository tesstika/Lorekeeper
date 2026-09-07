import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { env } from '../env';
import type { LorekeeperDb } from './client';
import { createDb } from './client';

export function runMigrations(db: LorekeeperDb): void {
  migrate(db, { migrationsFolder: env.migrationsDir });
}

if (import.meta.main) {
  mkdirSync(env.dataDir, { recursive: true });
  const { db } = createDb(path.join(env.dataDir, 'lorekeeper.db'));
  runMigrations(db);
  console.log(`migrations applied to ${path.join(env.dataDir, 'lorekeeper.db')}`);
}
