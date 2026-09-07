import { healthResponseSchema } from '@lorekeeper/shared';
import { env } from '../env';
import type { AppInstance } from '../types/app';

export async function registerHealthRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/api/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => {
      const row = app.sqlite.query('SELECT 1 AS ok').get() as { ok: number } | null;
      return {
        ok: true,
        version: env.version,
        db: row?.ok === 1 ? 'ok' : 'error',
      } as const;
    },
  );
}
