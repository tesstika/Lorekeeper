import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
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
import { registerHealthRoutes } from './routes/health';

export interface BuildAppOptions {
  dataDir?: string;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const dataDir = options.dataDir ?? env.dataDir;
  mkdirSync(dataDir, { recursive: true });
  const mediaDir = path.join(dataDir, 'media');
  mkdirSync(mediaDir, { recursive: true });

  const app = Fastify({ logger: { level: 'warn' } }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const { db, sqlite } = createDb(path.join(dataDir, 'lorekeeper.db'));
  runMigrations(db);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.addHook('onClose', () => {
    sqlite.close();
  });

  await registerHealthRoutes(app);

  let spaEnabled = false;
  if (existsSync(env.frontendDistDir)) {
    await app.register(fastifyStatic, { root: env.frontendDistDir, wildcard: false, index: false });
    spaEnabled = true;
  }
  await app.register(fastifyStatic, { root: mediaDir, prefix: '/media/', decorateReply: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = (error as { details?: unknown }).details;
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

  return app;
}
