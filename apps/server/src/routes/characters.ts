import {
  characterInputSchema,
  characterPatchSchema,
  characterSchema,
  importCardResponseSchema,
  okResponseSchema,
} from '@lorekeeper/shared';
import { z } from 'zod';
import {
  buildCardExport,
  CardParseError,
  cardExportFilename,
  parseCard,
} from '../services/cardParser';
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  updateCharacter,
} from '../services/charactersRepo';
import type { AppInstance } from '../types/app';
import { httpError } from '../util/http';

const idParams = z.object({ id: z.string() });

const characterInUseResponseSchema = z.object({
  statusCode: z.number(),
  code: z.literal('character_in_use'),
  message: z.string(),
  chatCount: z.number().int(),
});

const deleteQuerySchema = z.object({ force: z.string().optional() });

const exportQuerySchema = z.object({ format: z.enum(['v2', 'v3']).default('v2') });

/** Import accepts any raw JSON object; `parseCard` does the tolerant mapping. */
const importBodySchema = z.record(z.string(), z.unknown());

export async function registerCharacterRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/api/characters',
    { schema: { response: { 200: z.array(characterSchema) } } },
    async () => listCharacters(app.db),
  );

  app.post(
    '/api/characters',
    {
      schema: {
        body: characterInputSchema,
        response: { 201: characterSchema },
      },
    },
    async (request, reply) => {
      const character = createCharacter(app.db, request.body);
      return reply.code(201).send(character);
    },
  );

  app.post(
    '/api/characters/import',
    {
      schema: {
        body: importBodySchema,
        response: { 201: importCardResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const card = parseCard(request.body);
        // Enforce the shared field caps before insert: the raw-card body schema
        // is unbounded, and a row that violates characterSchema would otherwise
        // fail response serialization AFTER the insert (500 + half-persisted
        // import). Oversized/malformed cards get a clean 400 invalid_card.
        const input = characterInputSchema.safeParse({
          name: card.name,
          description: card.description,
          personality: card.personality,
          scenario: card.scenario,
          firstMessage: card.firstMessage,
          exampleDialogue: card.exampleDialogue,
          creatorNotes: card.creatorNotes,
          systemExtras: card.systemExtras,
          jailbreak: card.jailbreak,
          tags: card.tags,
          alternateGreetings: card.alternateGreetings,
          extensions: card.extensions,
        });
        if (!input.success) {
          const issue = input.error.issues[0];
          throw new CardParseError(
            `Card field limits exceeded: ${issue?.path.join('.') ?? 'body'} — ${issue?.message ?? 'invalid'}`,
          );
        }
        const character = createCharacter(app.db, input.data);
        return reply.code(201).send({ character, detectedFormat: card.format });
      } catch (error) {
        if (error instanceof CardParseError) {
          throw httpError(400, error.code, error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    '/api/characters/:id',
    {
      schema: {
        params: idParams,
        response: { 200: characterSchema },
      },
    },
    async (request) => {
      const character = getCharacter(app.db, request.params.id);
      if (!character) {
        throw httpError(404, 'not_found', `Character ${request.params.id} does not exist`);
      }
      return character;
    },
  );

  app.patch(
    '/api/characters/:id',
    {
      schema: {
        params: idParams,
        body: characterPatchSchema,
        response: { 200: characterSchema },
      },
    },
    async (request) => {
      const character = updateCharacter(app.db, request.params.id, request.body);
      if (!character) {
        throw httpError(404, 'not_found', `Character ${request.params.id} does not exist`);
      }
      return character;
    },
  );

  app.delete(
    '/api/characters/:id',
    {
      schema: {
        params: idParams,
        querystring: deleteQuerySchema,
        response: { 200: okResponseSchema, 409: characterInUseResponseSchema },
      },
    },
    async (request, reply) => {
      const force = request.query.force === '1';
      const result = deleteCharacter(app.db, request.params.id, force);
      if (!result.ok && result.chatCount === 0) {
        throw httpError(404, 'not_found', `Character ${request.params.id} does not exist`);
      }
      if (!result.ok) {
        return reply.code(409).send({
          statusCode: 409,
          code: 'character_in_use' as const,
          message: `Character is referenced by ${result.chatCount} chat${result.chatCount === 1 ? '' : 's'}. Delete the chats first or force the cascade.`,
          chatCount: result.chatCount,
        });
      }
      return { ok: true as const };
    },
  );

  app.get(
    '/api/characters/:id/export',
    {
      schema: {
        params: idParams,
        querystring: exportQuerySchema,
      },
    },
    async (request, reply) => {
      const character = getCharacter(app.db, request.params.id);
      if (!character) {
        throw httpError(404, 'not_found', `Character ${request.params.id} does not exist`);
      }
      const format = request.query.format;
      const card = buildCardExport(character, format);
      reply.header(
        'content-disposition',
        `attachment; filename="${cardExportFilename(character, format)}"`,
      );
      return card;
    },
  );
}
