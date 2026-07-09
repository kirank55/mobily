import { createRequire } from 'node:module';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Session } from './session.js';
import { startServer } from './ws.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export async function main(): Promise<void> {
  const session = new Session({ cols: 80, rows: 24 });
  const server = await startServer({ session });

  console.log(`mobily v${pkg.version}`);
  console.log(`WebSocket:  ${server.url}`);

  const smokePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'dev',
    'smoke.html',
  );
  if (existsSync(smokePath)) {
    console.log(`Smoke test: ${pathToFileURL(smokePath).href}?port=${server.port}`);
  } else {
    console.log(`Smoke test: open cli/dev/smoke.html?port=${server.port}`);
  }
  console.log('Press Ctrl+C to exit.');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down…`);
    try {
      session.dispose();
      await server.close();
    } catch (err) {
      console.error(err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
