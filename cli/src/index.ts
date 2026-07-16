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
import { defaultBindingFile, FileBindingRepository } from './bindings.js';
import { isDevTunnelsProvider, type DevTunnelsProvider } from './tunnel/devtunnels.js';
import { GitService } from './git/service.js';
import { RpcRouter } from './rpc/router.js';
import type { IDisposable } from './pty/node-pty.js';
import {
  attachWorkstationTerminal,
  shouldEmbedWorkstationTerminal,
  workstationTerminalSize,
  type WorkstationShutdownCause,
} from './workstationTerminal.js';
import { createSessionBackend, killTmuxSession, validateSessionName } from './mux/factory.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tunnel: { type: 'string' },
      'allow-insecure-local': { type: 'boolean', default: false },
      'devtunnels-provider': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      'list-bindings': { type: 'boolean', default: false },
      'revoke-binding': { type: 'string' },
      session: { type: 'string' },
      'kill-session': { type: 'string' },
    },
  });

  if (values['kill-session']) {
    const name = validateSessionName(values['kill-session']);
    killTmuxSession(name);
    console.log(`Terminated tmux session: ${name}`);
    return;
  }
  const requestedSessionName = values.session ? validateSessionName(values.session) : undefined;

  const bindingRepository = new FileBindingRepository(defaultBindingFile());
  if (values['list-bindings']) {
    const bindings = bindingRepository.list();
    if (bindings.length === 0) {
      console.log('No Device Key bindings are stored on this Station.');
    } else {
      for (const binding of bindings) {
        console.log(
          `${binding.deviceBindingId}\t${binding.stationName}\t${binding.pairedAt.toISOString()}`,
        );
      }
    }
    return;
  }
  if (values['revoke-binding']) {
    if (!bindingRepository.revoke(values['revoke-binding'])) {
      throw new UserFacingError(`No Device Key binding found: ${values['revoke-binding']}`);
    }
    console.log(`Revoked Device Key binding: ${values['revoke-binding']}`);
    return;
  }

  const tunnelFlag = values.tunnel;
  if (!tunnelFlag) {
    console.error(
      "Choose a tunnel: '--tunnel devtunnels' (hosted relay) or '--tunnel local' (pinned TLS on your LAN).",
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
  const auth = new AuthManager(os.hostname(), bindingRepository);
  const tunnel = await createTunnelBackend(tunnelId, {
    devtunnelsProvider,
    verbose: values.verbose,
    allowInsecureLocal: values['allow-insecure-local'],
  });
  const cwd = process.cwd();
  const workstationSize = workstationTerminalSize(process.stdout);
  const sessionBackend = createSessionBackend({
    cols: workstationSize.cols,
    rows: workstationSize.rows,
    cwd,
    sessionName: requestedSessionName,
  });
  const session = new Session({
    backend: sessionBackend,
    auth,
    rpc: new RpcRouter(new GitService(cwd)),
  });
  const server = await startServer({
    session,
    host: tunnel.bindHost,
    httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    tls: tunnel.serverTls,
  });
  const connection: TunnelConnection = await tunnel.connect(server.port);
  auth.setTunnelUrl(connection.url, connection.certificatePin);

  const pairingCode = auth.generatePairingCode();
  const pairingPayload = encodePairingPayload({
    endpoint: connection.url,
    code: pairingCode,
    expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
    protocolVersion: PROTOCOL_VERSION,
    certificatePin: connection.certificatePin,
  });

  let workstationTerminal: IDisposable | null = null;
  let sessionExitSubscription: IDisposable | null = null;
  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    workstationTerminal?.dispose();
    workstationTerminal = null;
    sessionExitSubscription?.dispose();
    sessionExitSubscription = null;
    console.log(`${reason}; shutting down…`);
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
  process.on('SIGINT', () => void shutdown('SIGINT received'));
  process.on('SIGTERM', () => void shutdown('SIGTERM received'));
  sessionExitSubscription = session.onExit(() => void shutdown('Session exited'));

  const embedsWorkstation = shouldEmbedWorkstationTerminal(sessionBackend);

  console.log(`mobily v${pkg.version}`);
  console.log(`Tunnel:       ${connection.url}`);
  console.log(
    `Session:      ${sessionBackend.kind}${sessionBackend.sessionName ? ` (${sessionBackend.sessionName})` : ''}`,
  );
  if (embedsWorkstation) {
    console.log('Workstation:  embedded in this CLI below');
    if (sessionBackend.attachCommand) {
      console.log(`Additional:   ${sessionBackend.attachCommand}`);
    }
  } else if (sessionBackend.kind === 'tmux') {
    console.log('Workstation:  open a second terminal (pairing QR stays visible here)');
    console.log(`Attach:       ${sessionBackend.attachCommand}`);
  } else {
    console.log('Workstation:  embedded terminal unavailable (interactive TTY required)');
    if (sessionBackend.attachCommand) {
      console.log(`Attach:       ${sessionBackend.attachCommand}`);
    } else {
      console.log('Fallback:     unavailable in bare mode; the session ends when the CLI exits');
    }
  }
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
  if (existsSync(smokePath) && !tunnel.serverTls) {
    console.log(
      `Smoke test:   ${pathToFileURL(smokePath).href}?port=${server.port}&endpoint=${encodeURIComponent(connection.url)}`,
    );
  } else if (!tunnel.serverTls) {
    console.log(`Smoke test:   open cli/dev/smoke.html?port=${server.port}`);
  }
  if (embedsWorkstation) {
    console.log('Controls:     Ctrl+C exits Mobily; Ctrl+X interrupts the shared session.');
    console.log();
    workstationTerminal = attachWorkstationTerminal(session, {
      onShutdown: (reason) => void shutdown(workstationShutdownMessage(reason)),
    });
  } else {
    console.log('Press Ctrl+C to exit.');
  }
}

function workstationShutdownMessage(reason: WorkstationShutdownCause): string {
  switch (reason) {
    case 'ctrl-c':
      return 'Ctrl+C received';
    case 'input-closed':
      return 'Input closed';
    case 'session-exited':
      return 'Session exited';
    case 'output-failed':
      return 'Workstation output failed';
  }
}

const verbose = process.argv.includes('--verbose');
main().catch((err: unknown) => {
  console.error(formatCliError(err, verbose));
  process.exit(1);
});
