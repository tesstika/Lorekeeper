import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { attachments, settings as settingsTable } from '../db/schema';
import { ImageCaptioner } from '../services/imageCaptioner';
import { getImageCaptioning } from '../services/settingsRepo';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-captioner-'));
const secretKeyPath = path.join(dataDir, 'secret.key');

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = secretKeyPath;
  app = await buildApp({ dataDir });
  await app.ready();
  // A real image file on disk for the happy path.
  writeFileSync(
    path.join(dataDir, 'media', 'test.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
});

afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows WAL handles — best-effort cleanup.
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function insertAttachment(filePath: string): { id: string } {
  const id = crypto.randomUUID();
  app.db
    .insert(attachments)
    .values({
      id,
      messageId: null,
      filePath,
      originalName: 'photo.png',
      mimeType: 'image/png',
      width: 8,
      height: 8,
      sizeBytes: 8,
      caption: null,
      createdAt: new Date().toISOString(),
    })
    .run();
  return { id };
}

function attachmentRow(id: string) {
  const rows = app.db.select().from(attachments).all();
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`attachment ${id} missing`);
  return row;
}

const MOONDREAM_TAG = 'moondream:latest';

function stubFetch(routes: Record<string, () => Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [fragment, handler] of Object.entries(routes)) {
      if (url.includes(fragment)) return handler();
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const TAGS_ROUTE = (names: string[]) => () =>
  new Response(JSON.stringify({ models: names.map((name) => ({ name, size: 1 })) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const GENERATE_ROUTE =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

describe('ImageCaptioner', () => {
  it('defaults the settings section to disabled with the Moondream2 model', () => {
    const settings = getImageCaptioning(app.db);
    expect(settings).toMatchObject({
      enabled: false,
      providerId: 'ollama',
      modelId: 'moondream:latest',
    });
    expect(settings.prompt).toContain('rich detail');
  });

  it('heals stored rows still carrying the retired vision-less hf.co tag', () => {
    // Simulate a pre-fix install row.
    app.db
      .insert(settingsTable)
      .values({
        key: 'imageCaptioning',
        value: {
          enabled: true,
          providerId: 'ollama',
          modelId: 'hf.co/corono1/moondream2-2b-q4_k_m-gguf',
          prompt: 'Describe.',
        },
        updatedAt: new Date().toISOString(),
      })
      .run();
    const healed = getImageCaptioning(app.db);
    expect(healed.modelId).toBe('moondream:latest');
    expect(healed.enabled).toBe(true);
    // Restore the clean row — later tests read this section.
    app.sqlite.run("DELETE FROM settings WHERE key = 'imageCaptioning'");
  });

  it('persists and returns the generated caption (cached afterwards)', async () => {
    const { id } = insertAttachment('media/test.png');
    const fetchMock = stubFetch({
      '/api/tags': TAGS_ROUTE([MOONDREAM_TAG]),
      '/api/generate': GENERATE_ROUTE({ response: '  A woman smiles by a rainy window.  ' }),
    });

    const captioner = new ImageCaptioner(app.db, dataDir);
    const first = await captioner.captionAttachment(attachmentRow(id));
    expect(first.caption).toBe('A woman smiles by a rainy window.');
    expect(first.warning).toBeNull();

    // Caption cached in SQLite.
    expect(attachmentRow(id).caption).toBe('A woman smiles by a rainy window.');

    // Second call is a cache hit — no network, no Ollama call.
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await captioner.captionAttachment(attachmentRow(id));
    expect(second.caption).toBe('A woman smiles by a rainy window.');
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    // The generate request carries the settings prompt + image bytes.
    const [, init] = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/generate'),
    ) as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model?: string;
      prompt?: string;
      images?: string[];
    };
    expect(body.model).toBe('moondream:latest');
    expect(body.prompt).toContain('rich detail');
    expect(body.images).toHaveLength(1);
  });

  it('fails gracefully when Ollama is offline', async () => {
    const { id } = insertAttachment('media/test.png');
    stubFetch({
      '/api/tags': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const captioner = new ImageCaptioner(app.db, dataDir);
    const result = await captioner.captionAttachment(attachmentRow(id));
    expect(result.caption).toBeNull();
    expect(result.warning).toContain('Ollama is not running');
    expect(attachmentRow(id).caption).toBeNull();
  });

  it('fails gracefully when the vision model is not pulled', async () => {
    const { id } = insertAttachment('media/test.png');
    stubFetch({ '/api/tags': TAGS_ROUTE([]) });
    const captioner = new ImageCaptioner(app.db, dataDir);
    const result = await captioner.captionAttachment(attachmentRow(id));
    expect(result.caption).toBeNull();
    expect(result.warning).toContain('not downloaded');
    expect(attachmentRow(id).caption).toBeNull();
  });

  it('fails gracefully on an Ollama error response', async () => {
    const { id } = insertAttachment('media/test.png');
    stubFetch({
      '/api/tags': TAGS_ROUTE([MOONDREAM_TAG]),
      '/api/generate': GENERATE_ROUTE({ error: 'model does not support images' }, 400),
    });
    const captioner = new ImageCaptioner(app.db, dataDir);
    const result = await captioner.captionAttachment(attachmentRow(id));
    expect(result.caption).toBeNull();
    expect(result.warning).toContain('HTTP 400');
    expect(attachmentRow(id).caption).toBeNull();
  });
});
