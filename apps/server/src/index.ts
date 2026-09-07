import { buildApp } from './app';
import { env } from './env';

const app = await buildApp();

try {
  await app.listen({ port: env.port, host: env.host });
  console.log(`Lorekeeper listening on http://${env.host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
