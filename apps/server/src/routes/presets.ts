import {
  okResponseSchema,
  presetInputSchema,
  presetPatchSchema,
  presetSchema,
} from '@lorekeeper/shared';
import { z } from 'zod';
import { createPreset, deletePreset, listPresets, updatePreset } from '../services/presetsRepo';
import type { AppInstance } from '../types/app';
import { httpError } from '../util/http';

export async function registerPresetRoutes(app: AppInstance): Promise<void> {
  app.get('/api/presets', { schema: { response: { 200: z.array(presetSchema) } } }, async () =>
    listPresets(app.db),
  );

  app.post(
    '/api/presets',
    {
      schema: {
        body: presetInputSchema,
        response: { 201: presetSchema },
      },
    },
    async (request, reply) => {
      const preset = createPreset(app.db, request.body);
      return reply.code(201).send(preset);
    },
  );

  app.patch(
    '/api/presets/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: presetPatchSchema,
        response: { 200: presetSchema },
      },
    },
    async (request) => {
      const preset = updatePreset(app.db, request.params.id, request.body);
      if (!preset) {
        throw httpError(404, 'not_found', `Preset ${request.params.id} does not exist`);
      }
      return preset;
    },
  );

  app.delete(
    '/api/presets/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      const removed = deletePreset(app.db, request.params.id);
      if (!removed) {
        throw httpError(404, 'not_found', `Preset ${request.params.id} does not exist`);
      }
      return { ok: true as const };
    },
  );
}
