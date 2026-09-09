import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-routes-'));
const secretKeyPath = path.join(dataDir, 'secret.key');

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = secretKeyPath;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

const OPENROUTER_KEY = 'sk-or-v1-supersecret123456';

describe('settings sections', () => {
  it('returns resolved defaults on first GET', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.globalDefaults).toMatchObject({
      providerId: null,
      modelId: null,
      contextBudgetTokens: 8192,
      keepLastNVariants: 20,
    });
    expect(body.promptTemplate.systemTemplate).toContain('{{char}}');
    expect(body.composer).toMatchObject({
      enterToSend: true,
      autoScroll: true,
      caretBlinkMs: 500,
      deliveredBlinkMs: 250,
      deliveredBlinks: 6,
      editDefaultRegenerate: false,
    });
  });

  it('PATCH merges partial sections and persists them', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: {
        composer: { caretBlinkMs: 750, enterToSend: false },
        globalDefaults: { providerId: 'openrouter', modelId: 'anthropic/claude-3.5-sonnet' },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().composer).toMatchObject({
      caretBlinkMs: 750,
      enterToSend: false,
      autoScroll: true,
    });
    const followUp = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(followUp.json().globalDefaults).toMatchObject({ providerId: 'openrouter' });
    // Unpatched composer keys keep defaults.
    expect(followUp.json().composer.autoScroll).toBe(true);

    // A later partial patch must NOT reset untouched keys. fastify-type-provider-zod
    // v7 validates request bodies through the z.output direction, which injects
    // schema defaults — the patch schemas are therefore defaults-free.
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { composer: { deliveredBlinks: 9 }, globalDefaults: { modelId: 'other/model' } },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().composer).toMatchObject({
      caretBlinkMs: 750,
      enterToSend: false,
      autoScroll: true,
      deliveredBlinks: 9,
    });
    expect(second.json().globalDefaults).toMatchObject({
      providerId: 'openrouter',
      modelId: 'other/model',
    });
  });

  it('rejects invalid values with the validation envelope (narrowed details)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { composer: { caretBlinkMs: 20 } },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('validation_error');
    expect(Array.isArray(body.details)).toBe(true);
    const detail = body.details[0];
    expect(detail).toHaveProperty('keyword');
    expect(detail).toHaveProperty('path');
    expect(detail).toHaveProperty('message');
    expect(detail).toHaveProperty('params');
  });
});

describe('presets', () => {
  it('seeds exactly one default preset on first boot', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/presets' });
    expect(response.statusCode).toBe(200);
    const presets = response.json();
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({
      name: 'Default Sanctum',
      temperature: 0.85,
      topP: 0.92,
      maxTokens: 4096,
      isDefault: true,
    });
  });

  it('creates, updates and enforces the single-default invariant', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'Gritty Noir', temperature: 0.65, topK: 40, stopSequences: ['User:'] },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ temperature: 0.65, topK: 40, isDefault: false });

    const second = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'Second Default', isDefault: true },
    });
    expect(second.statusCode).toBe(201);
    const secondId = second.json().id;

    const list = await app.inject({ method: 'GET', url: '/api/presets' });
    const defaults = list.json().filter((preset: { isDefault: boolean }) => preset.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe('Second Default');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/presets/${secondId}`,
      payload: { temperature: 1.1 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: secondId,
      temperature: 1.1,
      name: 'Second Default',
    });

    // Partial preset patch: untouched keys survive (no default injection).
    expect(patched.json().maxTokens).toBe(4096);
    expect(patched.json().topP).toBe(0.92);
    expect(patched.json().isDefault).toBe(true);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/presets/does-not-exist',
      payload: { temperature: 1.1 },
    });
    expect(missing.statusCode).toBe(404);
    void first;
  });

  it('deletes presets and clears dangling globalDefaults.presetId', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'Doomed Preset' },
    });
    const id = created.json().id;
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { globalDefaults: { presetId: id } },
    });

    const removed = await app.inject({ method: 'DELETE', url: `/api/presets/${id}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });

    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.json().globalDefaults.presetId).toBeNull();
  });

  it('validates preset input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: '', temperature: 99 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_error');
  });
});

describe('provider keys', () => {
  it('stores keys encrypted at rest and exposes only the hint', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/providers/openrouter/key',
      payload: { key: OPENROUTER_KEY },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true, keyHint: 'sk-or-…3456' });

    // Envelope persisted in the settings table — no plaintext anywhere.
    // (bun:sqlite returns the raw TEXT; the json-mode column is a JSON string.)
    const rows = app.sqlite
      .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'apiKeys'")
      .all();
    const envelope = JSON.parse(rows[0]?.value ?? '{}').openrouter as
      | { encrypted: string; iv: string; tag: string; hint: string }
      | undefined;
    expect(envelope).toBeDefined();
    expect(envelope?.encrypted).toBeTruthy();
    expect(envelope?.iv).toBeTruthy();
    expect(envelope?.tag).toBeTruthy();
    expect(atob(envelope?.encrypted ?? '')).not.toContain('supersecret');
    expect(envelope?.hint).toBe('sk-or-…3456');

    const providers = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(providers.statusCode).toBe(200);
    const list = providers.json();
    const openrouter = list.find((p: { id: string }) => p.id === 'openrouter');
    expect(openrouter).toMatchObject({
      hasKey: true,
      keyHint: 'sk-or-…3456',
      status: 'connected',
      latencyMs: null,
    });
    const unorouter = list.find((p: { id: string }) => p.id === 'unorouter');
    expect(unorouter).toMatchObject({ hasKey: false, status: 'no_key', keyHint: null });
    // Masking invariant: the raw key appears nowhere in any settings/providers payload.
    expect(providers.body).not.toContain(OPENROUTER_KEY);
    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.body).not.toContain(OPENROUTER_KEY);
  });

  it('rejects keys shorter than 8 characters', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/providers/unorouter/key',
      payload: { key: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_error');
  });

  it('rejects unknown provider ids', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/providers/notaprovider/key',
      payload: { key: 'sk-some-key-123' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports no_key when testing without a stored key', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/providers/unorouter/test' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'error', code: 'no_key' });
  });

  it('tests the connection and persists latency', async () => {
    // D-T10: the OpenRouter probe hits the AUTHENTICATED /auth/key endpoint,
    // not the public /models catalog — a valid key answers 200, an invalid
    // one 401 (invalid_key), so the Connected badge can no longer lie.
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith('/auth/key')) {
        return new Response(JSON.stringify({ data: { label: 'k', usage: 0 } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const test = await app.inject({ method: 'POST', url: '/api/providers/openrouter/test' });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ status: 'connected' });
    expect(test.json().latencyMs).toBeGreaterThanOrEqual(1);
    expect(requestedUrls.some((url) => url.endsWith('/api/v1/auth/key'))).toBe(true);

    const providers = await app.inject({ method: 'GET', url: '/api/providers' });
    const openrouter = providers.json().find((p: { id: string }) => p.id === 'openrouter');
    expect(openrouter.status).toBe('connected');
    expect(openrouter.latencyMs).toBeGreaterThanOrEqual(1);

    // Failure path: an expired/invalid key is rejected by /auth/key itself.
    const fetchMock401 = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock401);
    const failing = await app.inject({ method: 'POST', url: '/api/providers/openrouter/test' });
    expect(failing.statusCode).toBe(200);
    expect(failing.json()).toMatchObject({ status: 'error', code: 'invalid_key' });
    const after = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(after.json().find((p: { id: string }) => p.id === 'openrouter').status).toBe('error');
  });

  it('caches the model catalog for 24h and supports manual refresh', async () => {
    const payload = {
      data: [
        {
          id: 'm/one',
          name: 'Model One',
          context_length: 8192,
          architecture: { input_modalities: ['text', 'image'] },
        },
        { id: 'm/two', name: 'Model Two' },
      ],
    };
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );

    // No key + no cache → explicit error.
    const noKey = await app.inject({ method: 'GET', url: '/api/providers/unorouter/models' });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe('no_key');

    const first = await app.inject({ method: 'GET', url: '/api/providers/openrouter/models' });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.cached).toBe(false);
    expect(body.models).toHaveLength(2);
    expect(body.models[0]).toMatchObject({
      id: 'm/one',
      contextLength: 8192,
      inputModalities: ['text', 'image'],
    });
    expect(typeof body.fetchedAt).toBe('string');

    const second = await app.inject({ method: 'GET', url: '/api/providers/openrouter/models' });
    expect(second.json().cached).toBe(true);
    expect(second.json().fetchedAt).toBe(body.fetchedAt);

    const refreshed = await app.inject({
      method: 'GET',
      url: '/api/providers/openrouter/models?refresh=1',
    });
    expect(refreshed.json().cached).toBe(false);
    expect(calls).toBe(2);

    // Persisted into settings as modelCache:openrouter.
    const cacheRows = app.sqlite
      .query<{ value: string }, []>(
        "SELECT value FROM settings WHERE key = 'modelCache:openrouter'",
      )
      .all();
    const cache = JSON.parse(cacheRows[0]?.value ?? '{}') as {
      fetchedAt: string;
      models: unknown[];
    };
    expect(cache.models).toHaveLength(2);
  });

  it('removes the key and clears the test record', async () => {
    const removed = await app.inject({ method: 'DELETE', url: '/api/providers/openrouter/key' });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });
    const providers = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(providers.json().find((p: { id: string }) => p.id === 'openrouter')).toMatchObject({
      hasKey: false,
      status: 'no_key',
      latencyMs: null,
    });
  });
});

describe('health route', () => {
  it('still reports healthy and binds the shared version constant', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, db: 'ok', version: '0.1.0' });
  });
});

describe('data hygiene', () => {
  it('keeps the master key outside the data dir', () => {
    expect(existsSync(secretKeyPath)).toBe(true);
    expect(readFileSync(secretKeyPath).length).toBe(32);
  });
});
