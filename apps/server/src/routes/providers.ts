import {
  type OllamaPullProgressEvent,
  ollamaModelsResponseSchema,
  ollamaPullBodySchema,
  ollamaStatusResponseSchema,
  type ProviderId,
  providerIdSchema,
  providerInfoSchema,
  providerModelsResponseSchema,
  setProviderKeyBodySchema,
  setProviderKeyResponseSchema,
  testConnectionResponseSchema,
} from '@lorekeeper/shared';
import { z } from 'zod';
import { getProvider, OLLAMA_CURATED_MODELS, OLLAMA_OFFLINE_MESSAGE } from '../providers';
import {
  fetchOllamaStatus,
  fetchOllamaTags,
  ollamaTagsMatch,
  pullOllamaModel,
} from '../providers/ollama';
import { ProviderError } from '../providers/types';
import { KeyStore } from '../services/keyStore';
import {
  deleteSettingRaw,
  getModelCache,
  getProviderTest,
  setModelCache,
  setProviderTest,
} from '../services/settingsRepo';
import type { AppInstance } from '../types/app';
import { httpError, toHttpError } from '../util/http';

const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const providerParamsSchema = z.object({ id: providerIdSchema });
const modelsQuerySchema = z.object({ refresh: z.string().optional() });

export async function registerProviderRoutes(app: AppInstance): Promise<void> {
  const keyStore = new KeyStore(app.db);

  app.get(
    '/api/providers',
    { schema: { response: { 200: z.array(providerInfoSchema) } } },
    async () => {
      const ids: ProviderId[] = ['openrouter', 'unorouter', 'ollama'];
      return ids.map((id) => {
        const provider = getProvider(id);
        const hasKey = keyStore.hasKey(id);
        const test = getProviderTest(app.db, id);
        const cache = getModelCache(app.db, id);
        if (id === 'ollama') {
          // Local daemon: keyless by design. Status mirrors the last explicit
          // connection test, optimistically 'connected' before the first probe.
          return {
            id,
            label: provider.label,
            baseUrl: provider.baseUrl,
            hasKey: true,
            keyHint: null,
            status: test?.status ?? ('connected' as const),
            latencyMs: test?.latencyMs ?? null,
            modelsFetchedAt: cache?.fetchedAt ?? null,
          };
        }
        return {
          id,
          label: provider.label,
          baseUrl: provider.baseUrl,
          hasKey,
          keyHint: hasKey ? (keyStore.getEnvelope(id)?.hint ?? null) : null,
          status: hasKey ? (test?.status ?? 'connected') : 'no_key',
          latencyMs: test?.latencyMs ?? null,
          modelsFetchedAt: cache?.fetchedAt ?? null,
        };
      });
    },
  );

  app.put(
    '/api/providers/:id/key',
    {
      schema: {
        params: providerParamsSchema,
        body: setProviderKeyBodySchema,
        response: { 200: setProviderKeyResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const envelope = keyStore.setKey(id, request.body.key);
      return { ok: true as const, keyHint: envelope.hint };
    },
  );

  app.delete(
    '/api/providers/:id/key',
    {
      schema: {
        params: providerParamsSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const { id } = request.params;
      keyStore.removeKey(id);
      deleteSettingRaw(app.db, `providerTest:${id}`);
      return { ok: true as const };
    },
  );

  app.post(
    '/api/providers/:id/test',
    {
      schema: {
        params: providerParamsSchema,
        response: { 200: testConnectionResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const testedAt = new Date().toISOString();

      // Ollama is keyless — its "test" is a daemon reachability probe.
      if (id === 'ollama') {
        try {
          const { latencyMs } = await getProvider(id).testConnection('');
          setProviderTest(app.db, id, {
            status: 'connected',
            latencyMs,
            code: null,
            message: null,
            testedAt,
          });
          return { status: 'connected' as const, latencyMs, code: null, message: null };
        } catch (error) {
          const providerError =
            error instanceof ProviderError
              ? error
              : new ProviderError('network_error', 'Connection test failed');
          const message =
            providerError.code === 'network_error' ? OLLAMA_OFFLINE_MESSAGE : providerError.message;
          setProviderTest(app.db, id, {
            status: 'error',
            latencyMs: null,
            code: providerError.code,
            message,
            testedAt,
          });
          return { status: 'error' as const, latencyMs: null, code: providerError.code, message };
        }
      }

      if (!keyStore.hasKey(id)) {
        setProviderTest(app.db, id, {
          status: 'error',
          latencyMs: null,
          code: 'no_key',
          message: 'No API key stored for this provider',
          testedAt: new Date().toISOString(),
        });
        return {
          status: 'error' as const,
          latencyMs: null,
          code: 'no_key',
          message: 'No API key stored for this provider — save a key first.',
        };
      }
      let apiKey: string;
      try {
        apiKey = keyStore.decrypt(id);
      } catch (error) {
        return {
          status: 'error' as const,
          latencyMs: null,
          code: 'decrypt_failed',
          message: error instanceof Error ? error.message : 'Stored key could not be decrypted',
        };
      }
      try {
        const { latencyMs } = await getProvider(id).testConnection(apiKey);
        setProviderTest(app.db, id, {
          status: 'connected',
          latencyMs,
          code: null,
          message: null,
          testedAt,
        });
        return { status: 'connected' as const, latencyMs, code: null, message: null };
      } catch (error) {
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError('network_error', 'Connection test failed');
        setProviderTest(app.db, id, {
          status: 'error',
          latencyMs: null,
          code: providerError.code,
          message: providerError.message,
          testedAt,
        });
        return {
          status: 'error' as const,
          latencyMs: null,
          code: providerError.code,
          message: providerError.message,
        };
      }
    },
  );

  app.get(
    '/api/providers/:id/models',
    {
      schema: {
        params: providerParamsSchema,
        querystring: modelsQuerySchema,
        response: { 200: providerModelsResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const forceRefresh = request.query.refresh === '1';
      const cache = getModelCache(app.db, id);
      const fresh =
        cache !== null && Number.isFinite(Date.parse(cache.fetchedAt))
          ? Date.now() - Date.parse(cache.fetchedAt) < MODEL_CACHE_TTL_MS
          : false;

      // Fresh cache is served with no provider traffic — it works even without
      // a stored key. Stale cache is refreshed on open (plan §3: TTL 24 h).
      if (cache !== null && !forceRefresh && fresh) {
        return { models: cache.models, fetchedAt: cache.fetchedAt, cached: true };
      }

      // Ollama is keyless: its catalog is the static curated whitelist.
      if (id === 'ollama') {
        if (cache !== null && !forceRefresh) {
          return { models: cache.models, fetchedAt: cache.fetchedAt, cached: true };
        }
        try {
          const models = await getProvider(id).listModels('');
          const fetchedAt = new Date().toISOString();
          setModelCache(app.db, id, { fetchedAt, models });
          return { models, fetchedAt, cached: false };
        } catch (error) {
          throw toHttpError(error);
        }
      }

      if (!keyStore.hasKey(id)) {
        if (cache !== null && !forceRefresh) {
          // Graceful: stale catalog beats an error when no key is available.
          return { models: cache.models, fetchedAt: cache.fetchedAt, cached: true };
        }
        throw httpError(
          400,
          'no_key',
          `No API key stored for ${id} — save a key to fetch the model catalog.`,
        );
      }

      let apiKey: string;
      try {
        apiKey = keyStore.decrypt(id);
      } catch (error) {
        throw httpError(
          500,
          'decrypt_failed',
          error instanceof Error ? error.message : 'Stored key could not be decrypted',
        );
      }
      try {
        const models = await getProvider(id).listModels(apiKey);
        const fetchedAt = new Date().toISOString();
        setModelCache(app.db, id, { fetchedAt, models });
        return { models, fetchedAt, cached: false };
      } catch (error) {
        throw toHttpError(error);
      }
    },
  );

  // -- Ollama: daemon status, curated catalog state & pull management (§3) ----

  /** Live daemon probe — the Settings banner's source of truth. */
  app.get(
    '/api/providers/ollama/status',
    { schema: { response: { 200: ollamaStatusResponseSchema } } },
    async () => {
      return fetchOllamaStatus();
    },
  );

  /** Curated whitelist cross-referenced with the daemon's installed models. */
  app.get(
    '/api/providers/ollama/models',
    { schema: { response: { 200: ollamaModelsResponseSchema } } },
    async () => {
      const curated = OLLAMA_CURATED_MODELS.map((entry) => ({
        tag: entry.tag,
        label: entry.label,
        huggingFaceUrl: entry.huggingFaceUrl,
        downloaded: false,
        sizeBytes: null,
      }));
      const status = await fetchOllamaStatus();
      if (!status.running) {
        // Offline daemon: every curated model reads as not downloaded — the
        // UI renders the offline banner instead of a broken catalog.
        return { running: false, models: curated };
      }
      const tags = await fetchOllamaTags();
      return {
        running: true,
        models: curated.map((model) => {
          const pulled = tags.find((tag) => ollamaTagsMatch(tag.name, model.tag));
          return {
            ...model,
            downloaded: pulled !== undefined,
            ...(pulled ? { sizeBytes: pulled.size } : {}),
          };
        }),
      };
    },
  );

  /**
   * Streams a curated model pull as SSE progress frames. Hijacked like the
   * generation endpoints; client disconnect aborts the upstream pull.
   */
  app.post(
    '/api/providers/ollama/pull',
    { schema: { body: ollamaPullBodySchema } },
    async (request, reply) => {
      const { modelTag } = request.body;
      if (!OLLAMA_CURATED_MODELS.some((entry) => entry.tag === modelTag)) {
        throw httpError(400, 'invalid_model_tag', 'Only curated Lorekeeper models can be pulled.');
      }
      const status = await fetchOllamaStatus();
      if (!status.running) {
        throw httpError(503, 'ollama_offline', OLLAMA_OFFLINE_MESSAGE);
      }

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const controller = new AbortController();
      raw.on('close', () => controller.abort());
      const writeEvent = (event: OllamaPullProgressEvent): void => {
        if (raw.writableEnded || raw.destroyed) return;
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      try {
        for await (const event of pullOllamaModel(modelTag, controller.signal)) {
          writeEvent(event);
          if (event.status === 'success' || event.status === 'error') break;
        }
      } finally {
        raw.end();
      }
    },
  );
}
