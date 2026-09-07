import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.enum(['ok', 'error']),
});

export type HealthResponse = z.output<typeof healthResponseSchema>;
