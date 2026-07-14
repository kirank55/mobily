import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Session } from './session.js';
import { startServer } from './ws.js';
import { AuthManager } from './auth.js';
import { renderTerminalQr } from './qr.js';
import { createTunnelBackend, isTunnelId, type TunnelId } from './tunnel/index.js';
import type { TunnelConnection } from './tunnel/types.js';
import { encodePairingPayload, PROTOCOL_VERSION } from '@mobily/shared';
import { PAIRING_CODE_TTL_MS } from './auth.js';
import { formatCliError, UserFacingError } from './errors.js';
import {
  isDevTunnelsProvider,
  type DevTunnelsProvider,
} from './tunnel/devtunnels.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tunnel: { type: 'string' },
      'allow-insecure-local': { type: 'boolean', default: false },
      'devtunnels-provider': { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
  });

  const tunnelFlag = values.tunnel;
  if (!tunnelFlag) {
    console.error(
      "Choose a tunnel: '--tunnel devtunnels' (secure) or '--tunnel local --allow-insecure-local' (isolated development only).",
    );
    process.exit(1);
  }
  if (!isTunnelId(tunnelFlag)) {
    console.error(`Unknown --tunnel value: '${tunnelFlag}'. Use 'devtunnels' or 'local'.`);
    process.exit(1);
  }
  const tunnelId: TunnelId = tunnelFlag;
  const providerFlag = values['devtunnels-provider'];
  let devtunnelsProvider: DevTunnelsProvider | undefined;
  if (providerFlag !== undefined) {
    if (!isDevTunnelsProvider(providerFlag)) {
      throw new UserFacingError(
        `Unknown Dev Tunnels provider: '${providerFlag}'. Use 'github' or 'microsoft'.`,
      );
    }
    if (tunnelId !== 'devtunnels') {
      throw new UserFacingError('--devtunnels-provider can only be used with --tunnel devtunnels.');
    }
    devtunnelsProvider = providerFlag;
  }
  if (tunnelId === 'local' && !values['allow-insecure-local']) {
    console.error(
      "Local LAN transport is plaintext. Use '--tunnel local --allow-insecure-local' only for isolated development networks.",
    );
    process.exit(1);
  }

  const auth = new AuthManager(os.hostname());
  const tunnel = await createTunnelBackend(tunnelId, {
    devtunnelsProvider,
    verbose: values.verbose,
  });
  const session = new Session({ cols: 80, rows: 24, auth });
  const server = await startServer({
    session,
    host: tunnel.bindHost,
    httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
  });
  const connection: TunnelConnection = await tunnel.connect(server.port);
  auth.setTunnelUrl(connection.url);

  const pairingCode = auth.generatePairingCode();
  const pairingPayload = encodePairingPayload({
    endpoint: connection.url,
    code: pairingCode,
    expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
    protocolVersion: PROTOCOL_VERSION,
  });

  console.log(`mobily v${pkg.version}`);
  console.log(`Tunnel:       ${connection.url}`);
  console.log();
  console.log('  Scan this QR with the Mobily app to pair your device:');
  console.log();
  try {
    const qr = await renderTerminalQr(pairingPayload);
    const indent = '  ';
    console.log(
      qr
        .split('\n')
        .map((line) => `${indent}${line}`)
        .join('\n'),
    );
  } catch (err) {
    console.error(
      `  (QR unavailable — enter the code below) ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  console.log();
  console.log(`  Pairing code: ${pairingCode}`);
  console.log();
  console.log('  Or enter this code in the Mobily app to pair your device.');
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

const verbose = process.argv.includes('--verbose');
main().catch((err: unknown) => {
  console.error(formatCliError(err, verbose));
  process.exit(1);
});
