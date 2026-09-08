import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { FastifyError } from 'fastify';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { env } from './env';
import { registerAttachmentRoutes } from './routes/attachments';
import { registerCharacterRoutes } from './routes/characters';
import { registerHealthRoutes } from './routes/health';
import { registerPersonaRoutes } from './routes/personas';
import { registerPresetRoutes } from './routes/presets';
import { registerProviderRoutes } from './routes/providers';
import { registerSettingsRoutes } from './routes/settings';
import { ensureSeedPresets } from './services/presetsRepo';

export interface BuildAppOptions {
  dataDir?: string;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const dataDir = options.dataDir ?? env.dataDir;
  mkdirSync(dataDir, { recursive: true });
  const mediaDir = path.join(dataDir, 'media');
  mkdirSync(mediaDir, { recursive: true });

  const app = Fastify({
    logger: { level: 'warn' },
    // Fastify's 1 MiB default rejects schema-legal card imports (the shared
    // prose schemas allow ~3.6 MB across 18 fields; real SillyTavern cards
    // with large character_books exceed 1 MB). 8 MB matches the default
    // image cap family; zod caps still bound per-field abuse.
    bodyLimit: 8 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Handlers must be set BEFORE route registration: each route context captures
  // the instance error/not-found handler at registration time (fastify lib/context.js).
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // Narrowed guard from fastify-type-provider-zod v7: `validation` carries the
    // ZodFastifySchemaValidationError items (keyword/instancePath/message/params).
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((item) => ({
        keyword: item.keyword,
        path: item.instancePath,
        message: item.message,
        params: item.params,
      }));
      return reply.code(400).send({
        statusCode: 400,
        code: 'validation_error',
        message: 'Request validation failed',
        details,
      });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({
      statusCode,
      code: error.code ?? 'internal_error',
      message: error.message,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const urlPath = request.url.split('?')[0] ?? request.url;
    const hasFileExtension = /\.[a-z0-9]+$/i.test(urlPath);
    if (
      spaEnabled &&
      request.method === 'GET' &&
      !urlPath.startsWith('/api') &&
      !urlPath.startsWith('/media') &&
      !hasFileExtension
    ) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({
      statusCode: 404,
      code: 'not_found',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  const { db, sqlite } = createDb(path.join(dataDir, 'lorekeeper.db'));
  runMigrations(db);
  ensureSeedPresets(db);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.decorate('dataDir', dataDir);
  app.addHook('onClose', () => {
    sqlite.close();
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 32 * 1024 * 1024, files: 1 },
  });

  await registerHealthRoutes(app);
  await registerProviderRoutes(app);
  await registerPresetRoutes(app);
  await registerSettingsRoutes(app);
  await registerCharacterRoutes(app);
  await registerPersonaRoutes(app);
  await registerAttachmentRoutes(app);

  let spaEnabled = false;
  if (existsSync(env.frontendDistDir)) {
    await app.register(fastifyStatic, { root: env.frontendDistDir, wildcard: false, index: false });
    spaEnabled = true;
  }
  await app.register(fastifyStatic, { root: mediaDir, prefix: '/media/', decorateReply: false });

  return app;
}
