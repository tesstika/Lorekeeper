import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

describe('GET /api/health', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-test-'));
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

  it('reports a healthy database after auto-migration', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, db: 'ok' });
  });

  it('created the database file with migrated tables', () => {
    expect(existsSync(path.join(dataDir, 'lorekeeper.db'))).toBe(true);
    const tables = app.sqlite
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    for (const table of [
      'characters',
      'personas',
      'presets',
      'chats',
      'messages',
      'attachments',
      'settings',
    ]) {
      expect(tables).toContain(table);
    }
    // M1 addendum: per-character jailbreak groundwork (M2 Character Editor field).
    const characterColumns = app.sqlite
      .query<{ name: string }, []>('PRAGMA table_info(characters)')
      .all()
      .map((row) => row.name);
    expect(characterColumns).toContain('jailbreak');
    // Persona bugfix: chats.persona_none carries the explicit "play without a
    // persona" override (the '' sentinel violated the personas FK).
    const chatColumns = app.sqlite
      .query<{ name: string }, []>('PRAGMA table_info(chats)')
      .all()
      .map((row) => row.name);
    expect(chatColumns).toContain('persona_none');
  });

  it('returns a 404 envelope for unknown api routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
  });
});
