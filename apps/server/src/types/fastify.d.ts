import type { Database } from 'bun:sqlite';
import type { LorekeeperDb } from '../db/client';

declare module 'fastify' {
  interface FastifyInstance {
    db: LorekeeperDb;
    sqlite: Database;
  }
}
