import {
  okResponseSchema,
  personaDefaultResponseSchema,
  personaInputSchema,
  personaPatchSchema,
  personaSchema,
} from '@lorekeeper/shared';
import { z } from 'zod';
import {
  createPersona,
  deletePersona,
  getPersona,
  listPersonas,
  updatePersona,
} from '../services/personasRepo';
import type { AppInstance } from '../types/app';
import { httpError } from '../util/http';

const idParams = z.object({ id: z.string() });

export async function registerPersonaRoutes(app: AppInstance): Promise<void> {
  app.get('/api/personas', { schema: { response: { 200: z.array(personaSchema) } } }, async () =>
    listPersonas(app.db),
  );

  app.post(
    '/api/personas',
    {
      schema: {
        body: personaInputSchema,
        response: { 201: personaSchema },
      },
    },
    async (request, reply) => {
      const persona = createPersona(app.db, request.body);
      return reply.code(201).send(persona);
    },
  );

  app.get(
    '/api/personas/:id',
    {
      schema: {
        params: idParams,
        response: { 200: personaSchema },
      },
    },
    async (request) => {
      const persona = getPersona(app.db, request.params.id);
      if (!persona) {
        throw httpError(404, 'not_found', `Persona ${request.params.id} does not exist`);
      }
      return persona;
    },
  );

  app.patch(
    '/api/personas/:id',
    {
      schema: {
        params: idParams,
        body: personaPatchSchema,
        response: { 200: personaSchema },
      },
    },
    async (request) => {
      const persona = updatePersona(app.db, request.params.id, request.body);
      if (!persona) {
        throw httpError(404, 'not_found', `Persona ${request.params.id} does not exist`);
      }
      return persona;
    },
  );

  app.delete(
    '/api/personas/:id',
    {
      schema: {
        params: idParams,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      const removed = deletePersona(app.db, request.params.id);
      if (!removed) {
        throw httpError(404, 'not_found', `Persona ${request.params.id} does not exist`);
      }
      return { ok: true as const };
    },
  );

  app.put(
    '/api/personas/:id/default',
    {
      schema: {
        params: idParams,
        response: { 200: personaDefaultResponseSchema },
      },
    },
    async (request) => {
      const persona = updatePersona(app.db, request.params.id, { isDefault: true });
      if (!persona) {
        throw httpError(404, 'not_found', `Persona ${request.params.id} does not exist`);
      }
      return { persona };
    },
  );
}
