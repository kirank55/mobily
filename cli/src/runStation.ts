import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Session } from './session.js';
import { startServer, type Server } from './ws.js';
import { AuthManager, PAIRING_CODE_TTL_MS } from './auth.js';
import { startLineLoading } from './loading.js';
import { renderTerminalQr } from './qr.js';
import { createTunnelBackend } from './tunnel/index.js';
import type { TunnelConnection } from './tunnel/types.js';
import { encodePairingPayload, PROTOCOL_VERSION } from '@mobily/shared';
import { defaultBindingFile, FileBindingRepository } from './bindings.js';
import { GitService } from './gitService.js';
import { RpcRouter } from './rpcRouter.js';
import { workstationTerminalSize, type WorkstationShutdownCause } from './workstation/embedded.js';
import {
  beginWorkstationPresence,
  planWorkstationPresence,
  type WorkstationPresenceHandle,
} from './workstation/presence.js';
import { createSessionBackend } from './sessionBackend/factory.js';
import type { CliLifecycle } from './cliLifecycle.js';
import type { RunStationOptions } from './cliArgs.js';

export async function runStation(
  options: RunStationOptions,
  lifecycle: CliLifecycle,
  version: string,
): Promise<void> {
  const auth = new AuthManager(os.hostname(), new FileBindingRepository(defaultBindingFile()));
  const tunnel = await createTunnelBackend({
    devtunnelsProvider: options.devtunnelsProvider,
    verbose: options.verbose,
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
    sessionName: options.requestedSessionName,
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
  const stopLoading = startLineLoading('Preparing pairing QR…');
  let connection!: TunnelConnection;
  let pairingCode!: string;
  let renderedQr = '';
  let qrError: unknown;
  try {
    connection = await tunnel.connect(server.port);
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

    pairingCode = auth.generatePairingCode();
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

    try {
      renderedQr = await renderTerminalQr(pairingPayload);
    } catch (err) {
      qrError = err;
    }
  } finally {
    stopLoading();
  }

  const presencePlan = planWorkstationPresence(sessionBackend);
  console.log(`mobily v${version}`);
  console.log(`Tunnel:       ${connection.url}`);
  console.log(
    `Session:      ${sessionBackend.kind}${sessionBackend.sessionName ? ` (${sessionBackend.sessionName})` : ''}`,
  );
  for (const line of presencePlan.logLines) console.log(line);
  console.log();
  console.log('  Scan this QR with the Mobily app to pair your device:');
  console.log();
  if (renderedQr) {
    const indent = '  ';
    console.log(
      renderedQr
        .split('\n')
        .map((line) => `${indent}${line}`)
        .join('\n'),
    );
  } else {
    console.error(
      `  (QR unavailable — enter the code below) ${
        qrError instanceof Error ? qrError.message : String(qrError)
      }`,
    );
  }
  console.log();
  console.log(`  Pairing code: ${pairingCode}`);
  console.log();
  console.log('  Or enter this code in the Mobily app to pair your device.');
  console.log();

  const pairingPanel = [
    `mobily v${version}`,
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
