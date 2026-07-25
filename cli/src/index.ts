import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Session } from './session.js';
import { startServer, type Server } from './ws.js';
import { AuthManager } from './auth.js';
import { renderTerminalQr } from './qr.js';
import { createTunnelBackend } from './tunnel/index.js';
import type { TunnelConnection } from './tunnel/types.js';
import { encodePairingPayload, PROTOCOL_VERSION } from '@mobily/shared';
import { PAIRING_CODE_TTL_MS } from './auth.js';
import { UserFacingError } from './errors.js';
import { defaultBindingFile, FileBindingRepository } from './bindings.js';
import { isDevTunnelsProvider, type DevTunnelsProvider } from './tunnel/devtunnels.js';
import { GitService } from './git/service.js';
import { RpcRouter } from './rpc/router.js';
import { workstationTerminalSize, type WorkstationShutdownCause } from './workstationTerminal.js';
import {
  beginWorkstationPresence,
  planWorkstationPresence,
  type WorkstationPresenceHandle,
} from './workstationPresence.js';
import {
  createSessionBackend,
  exitCurrentMobily,
  hideCurrentQrPanel,
  killTmuxSession,
  validateSessionName,
} from './mux/factory.js';
import { CliLifecycle, createNodeCliLifecycleRuntime } from './cliLifecycle.js';
import { formatCliHelp } from './cliHelp.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
const cliLifecycle = new CliLifecycle(createNodeCliLifecycleRuntime());
cliLifecycle.installSignalHandlers();

export async function main(lifecycle: CliLifecycle = cliLifecycle): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      'devtunnels-provider': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      'list-bindings': { type: 'boolean', default: false },
      'revoke-binding': { type: 'string' },
      session: { type: 'string' },
      'kill-session': { type: 'string' },
    },
  });

  if (values.help) {
    console.log(formatCliHelp(pkg.version));
    return;
  }

  if (positionals[0] === 'exit') {
    if (!exitCurrentMobily()) {
      throw new UserFacingError("'mobily exit' must be run inside an attached tmux terminal.");
    }
    return;
  }

  if (positionals[0] === 'qr') {
    const action = positionals[1];
    if (action !== 'hide' && action !== 'clear') {
      throw new UserFacingError("Use 'mobily qr hide' or 'mobily qr clear'.");
    }
    if (!hideCurrentQrPanel()) throw new UserFacingError('No Mobily QR panel is visible.');
    if (action === 'clear') process.stdout.write('\u001b[2J\u001b[3J\u001b[H');
    return;
  }

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

  const providerFlag = values['devtunnels-provider'];
  let devtunnelsProvider: DevTunnelsProvider | undefined;
  if (providerFlag !== undefined) {
    if (!isDevTunnelsProvider(providerFlag)) {
      throw new UserFacingError(
        `Unknown Dev Tunnels provider: '${providerFlag}'. Use 'github' or 'microsoft'.`,
      );
    }
    devtunnelsProvider = providerFlag;
  }
  const auth = new AuthManager(os.hostname(), bindingRepository);
  const tunnel = await createTunnelBackend({
    devtunnelsProvider,
    verbose: values.verbose,
  });
  const cwd = process.cwd();
  const hasInteractiveWorkstation = Boolean(
    process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function',
  );
  const detectedWorkstationSize = workstationTerminalSize(process.stdout);
  const workstationSize = hasInteractiveWorkstation
    ? detectedWorkstationSize
    : { cols: 120, rows: 40 };
  const sessionBackend = createSessionBackend({
    cols: workstationSize.cols,
    rows: workstationSize.rows,
    cwd,
    sessionName: requestedSessionName,
  });
  const session = new Session({
    backend: sessionBackend,
    cols: workstationSize.cols,
    rows: workstationSize.rows,
    auth,
    rpc: new RpcRouter(new GitService(cwd)),
  });
  let workstationPresence: WorkstationPresenceHandle | null = null;
  let sessionExitSubscription: ReturnType<Session['onExit']> | null = null;
  let serverClose: Promise<void> | undefined;
  const server: Server = await startServer({
    session,
    host: tunnel.bindHost,
    httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    tls: tunnel.serverTls,
  });
  const connection: TunnelConnection = await tunnel.connect(server.port);
  lifecycle.setCleanup({
    temporaryTunnel: true,
    stopNewWork: () => {
      workstationPresence?.dispose();
      workstationPresence = null;
      sessionExitSubscription?.dispose();
      sessionExitSubscription = null;
      session.dispose();
      serverClose ??= server.close();
    },
    run: async (signal) => {
      session.dispose();
      serverClose ??= server.close();
      await serverClose;
      await connection.disconnect(signal);
    },
  });
  auth.setTunnelUrl(connection.url, connection.certificatePin);

  const pairingCode = auth.generatePairingCode();
  const pairingPayload = encodePairingPayload({
    endpoint: connection.url,
    code: pairingCode,
    expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
    protocolVersion: PROTOCOL_VERSION,
    certificatePin: connection.certificatePin,
  });

  sessionExitSubscription = session.onExit(() => {
    void lifecycle.requestShutdown('Session exited');
  });

  const presencePlan = planWorkstationPresence(sessionBackend);
  console.log(`mobily v${pkg.version}`);
  console.log(`Tunnel:       ${connection.url}`);
  console.log(
    `Session:      ${sessionBackend.kind}${sessionBackend.sessionName ? ` (${sessionBackend.sessionName})` : ''}`,
  );
  for (const line of presencePlan.logLines) console.log(line);
  console.log();
  console.log('  Scan this QR with the Mobily app to pair your device:');
  console.log();
  let renderedQr = '';
  try {
    renderedQr = await renderTerminalQr(pairingPayload);
    const indent = '  ';
    console.log(
      renderedQr
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

  const pairingPanel = [
    `mobily v${pkg.version}`,
    `Tunnel:  ${connection.url}`,
    `Session: ${sessionBackend.kind}${sessionBackend.sessionName ? ` (${sessionBackend.sessionName})` : ''}`,
    '',
    'Scan this QR with the Mobily app:',
    renderedQr || '(QR unavailable; use the pairing code below)',
    `Pairing code: ${pairingCode}`,
    '',
    'mobily qr hide   Hide this panel',
    'mobily qr clear  Hide it and clear the whole terminal',
  ].join('\n');

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

  workstationPresence = beginWorkstationPresence({
    session,
    backend: sessionBackend,
    pairingPanel,
    pairingPanelHeight: Math.min(
      pairingPanel.split('\n').length,
      Math.max(50, workstationSize.rows - 1),
    ),
    cwd,
    onEmbeddedShutdown: (reason) => {
      void lifecycle.requestShutdown(workstationShutdownMessage(reason));
    },
    onTmuxDetach: (message) => {
      console.log(message);
      void lifecycle.requestShutdown(message);
    },
    log: (line) => console.log(line),
  });

  if (presencePlan.mode === 'embedded') {
    console.log('Controls:     Ctrl+C interrupts the shared session; Ctrl+X exits Mobily.');
    console.log(
      'Waiting for the Android app to authenticate; this terminal will continue automatically.',
    );
    console.log();
  } else if (presencePlan.mode === 'tmux-attach') {
    console.log('Controls:     Ctrl+C interrupts the shared session; mobily exit exits Mobily.');
    console.log(
      'Waiting for the Android app to authenticate; this terminal will attach automatically.',
    );
    console.log();
  } else {
    console.log('Press Ctrl+C to exit.');
  }
}

function workstationShutdownMessage(reason: WorkstationShutdownCause): string {
  switch (reason) {
    case 'ctrl-x':
      return 'Ctrl+X received';
    case 'input-closed':
      return 'Input closed';
    case 'session-exited':
      return 'Session exited';
    case 'output-failed':
      return 'Workstation output failed';
  }
}

const verbose = process.argv.includes('--verbose');
process.on('uncaughtException', (error) => {
  void cliLifecycle.fail(error, verbose);
});
process.on('unhandledRejection', (reason) => {
  void cliLifecycle.fail(reason, verbose);
});
void main().catch((error: unknown) => cliLifecycle.fail(error, verbose));
