import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Session } from './session.js';
import { startServer } from './ws.js';
import { AuthManager } from './auth.js';
import {
  createTunnelBackend,
  isTunnelId,
  type TunnelId,
} from './tunnel/index.js';
import type { TunnelConnection } from './tunnel/types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tunnel: { type: 'string', default: 'local' },
    },
  });

  const tunnelFlag = values.tunnel;
  if (!tunnelFlag || !isTunnelId(tunnelFlag)) {
    console.error(
      `Unknown --tunnel value: '${tunnelFlag}'. Use 'local' (default) or 'devtunnels'.`,
    );
    process.exit(1);
  }
  const tunnelId: TunnelId = tunnelFlag;

  const auth = new AuthManager(os.hostname());
  const tunnel = await createTunnelBackend(tunnelId);
  const session = new Session({ cols: 80, rows: 24 });
  const server = await startServer({
    session,
    host: tunnel.bindHost,
    httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
  });
  const connection: TunnelConnection = await tunnel.connect(server.port);
  auth.setTunnelUrl(connection.url);

  const pairingCode = auth.generatePairingCode();

  console.log(`mobily v${pkg.version}`);
  console.log(`Tunnel:       ${connection.url}`);
  console.log();
  console.log(`  Pairing code: ${pairingCode}`);
  console.log();
  console.log('  Enter this code in the Mobily app to pair your device.');
  console.log('  (QR code display arrives in Phase 3, when the phone scanner ships.)');
  console.log();

  const smokePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'dev',
    'smoke.html',
  );
  if (existsSync(smokePath)) {
    console.log(`Smoke test:   ${pathToFileURL(smokePath).href}?port=${server.port}`);
  } else {
    console.log(`Smoke test:   open cli/dev/smoke.html?port=${server.port}`);
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
      await connection.disconnect();
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
