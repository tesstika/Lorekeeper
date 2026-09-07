import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

export function createDb(filePath: string) {
  const sqlite = new Database(filePath, { create: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  const db = drizzle({ client: sqlite, schema, casing: 'snake_case' });
  return { db, sqlite };
}

export type LorekeeperDb = ReturnType<typeof createDb>['db'];
