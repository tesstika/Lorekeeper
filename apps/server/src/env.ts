import path from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/server/src (portable under both Bun and Vite/Vitest transforms)
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

export const env = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: process.env.LOREKEEPER_DATA_DIR ?? path.join(repoRoot, 'data'),
  frontendDistDir: path.resolve(here, '..', '..', 'frontend', 'dist'),
  migrationsDir: path.resolve(here, '..', 'drizzle'),
  version: '0.1.0',
} as const;
