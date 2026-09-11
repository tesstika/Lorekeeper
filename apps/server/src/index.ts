import os from 'node:os';
import { buildApp } from './app';
import { env } from './env';

const app = await buildApp();

try {
  await app.listen({ port: env.port, host: env.host });
  const loopbackBind = ['127.0.0.1', 'localhost', '::1'].includes(env.host);
  if (loopbackBind) {
    console.log(`Lorekeeper listening on http://${env.host}:${env.port}`);
  } else {
    console.log(`Lorekeeper listening on ${env.host}:${env.port} (all interfaces)`);
    const lanAddresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry && String(entry.family) === 'IPv4' && !entry.internal)
      .map((entry) => entry?.address);
    for (const address of lanAddresses) {
      console.log(`  Phone/tablet on the same network → http://${address}:${env.port}`);
    }
    console.log(
      '  Note: the API has no authentication — this bind exposes Lorekeeper to your LAN.',
    );
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
