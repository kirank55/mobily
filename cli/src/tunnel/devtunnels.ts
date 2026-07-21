/**
 * Dev Tunnels integration through Microsoft's official `devtunnel` helper.
 * The helper owns account login and credential storage; Mobily owns the
 * first-run guidance and the lifetime of the temporary tunnel process.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { UserFacingError } from '../errors.js';
import {
  FileTemporaryTunnelOwnershipStore,
  type TemporaryTunnelOwnership,
  type TemporaryTunnelOwnershipStore,
} from './temporaryTunnelOwnership.js';
import type { TunnelBackend, TunnelConnection } from './types.js';

export type DevTunnelsProvider = 'github' | 'microsoft';

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DevTunnelHostProcess {
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exitCode: number | null;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** Process and terminal operations injected at the Dev Tunnels seam. */
export interface DevTunnelsRuntime {
  readonly interactive: boolean;
  readonly platform: NodeJS.Platform;
  findExecutable(): string | undefined;
  run(
    executable: string,
    args: readonly string[],
    options: { inheritStdio: boolean },
  ): Promise<CommandResult>;
  spawnHost(executable: string, args: readonly string[]): DevTunnelHostProcess;
  prompt(message: string): Promise<string>;
  write(message: string): void;
}

export interface PrepareDevTunnelsOptions {
  readonly provider?: DevTunnelsProvider;
  readonly verbose?: boolean;
  readonly readinessTimeoutMs?: number;
  readonly runtime?: DevTunnelsRuntime;
  readonly ownershipStore?: TemporaryTunnelOwnershipStore;
  readonly runId?: string;
  readonly processId?: number;
  readonly isProcessAlive?: (processId: number) => boolean;
  readonly now?: () => Date;
}

const DEFAULT_READINESS_TIMEOUT_MS = 60_000;
const HOST_SHUTDOWN_TIMEOUT_MS = 5_000;

/** Resolve the helper, guide first-run login, and return a ready backend. */
export async function prepareDevTunnelsBackend(
  options: PrepareDevTunnelsOptions = {},
): Promise<DevTunnelsBackend> {
  const runtime = options.runtime ?? createNodeRuntime();
  let executable = runtime.findExecutable();

  if (!executable && runtime.interactive) {
    runtime.write(`${installMessage(runtime.platform)}\n\n`);
    await promptUser(runtime, 'Install it in another terminal, then press Enter to retry: ');
    executable = runtime.findExecutable();
  }

  if (!executable) {
    throw new UserFacingError(installMessage(runtime.platform));
  }

  const ownershipStore = options.ownershipStore ?? new FileTemporaryTunnelOwnershipStore();
  const runId = options.runId ?? randomUUID();
  await ensureSignedIn(runtime, executable, options.provider);
  return new DevTunnelsBackend(executable, runtime, {
    provider: options.provider,
    verbose: options.verbose ?? false,
    readinessTimeoutMs: options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
    ownershipStore,
    runId,
    processId: options.processId ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? isProcessAlive,
    now: options.now ?? (() => new Date()),
  });
}

export function isDevTunnelsProvider(value: string): value is DevTunnelsProvider {
  return value === 'github' || value === 'microsoft';
}

async function ensureSignedIn(
  runtime: DevTunnelsRuntime,
  executable: string,
  requestedProvider?: DevTunnelsProvider,
  force = false,
): Promise<void> {
  if (!force) {
    const status = await runtime.run(executable, ['user', 'show'], { inheritStdio: false });
    if (hasCachedLogin(status)) return;
  }

  const provider = requestedProvider ?? (await promptForProvider(runtime));
  runtime.write(
    `Signing in to Dev Tunnels with ${provider === 'github' ? 'GitHub' : 'Microsoft'}…\n`,
  );
  const args = provider === 'github' ? ['user', 'login', '-g', '-d'] : ['user', 'login', '-d'];
  const login = await runtime.run(executable, args, { inheritStdio: true });
  if (login.exitCode !== 0) {
    throw new UserFacingError(
      'Dev Tunnels sign-in was not completed. Run Mobily again when you are ready to sign in.',
    );
  }
}

function hasCachedLogin(status: CommandResult): boolean {
  if (status.exitCode !== 0) return false;
  const output = `${status.stdout}\n${status.stderr}`.toLowerCase();
  return !/(not logged in|not signed in|no logged-in user|login required|token expired)/.test(
    output,
  );
}

async function promptForProvider(runtime: DevTunnelsRuntime): Promise<DevTunnelsProvider> {
  if (!runtime.interactive) {
    throw new UserFacingError(
      'Dev Tunnels sign-in is required. Rerun with --devtunnels-provider github or --devtunnels-provider microsoft.',
    );
  }

  for (;;) {
    const answer = (
      await promptUser(runtime, 'Choose an account: [1] GitHub (default), [2] Microsoft: ')
    )
      .trim()
      .toLowerCase();
    if (answer === '' || answer === '1' || answer === 'github' || answer === 'g') {
      return 'github';
    }
    if (answer === '2' || answer === 'microsoft' || answer === 'm') {
      return 'microsoft';
    }
    runtime.write("Enter '1' for GitHub or '2' for Microsoft.\n");
  }
}

async function promptUser(runtime: DevTunnelsRuntime, message: string): Promise<string> {
  try {
    return await runtime.prompt(message);
  } catch {
    throw new UserFacingError('Dev Tunnels setup was cancelled. Run Mobily again when ready.');
  }
}

/** TunnelBackend backed by a temporary `devtunnel host` child process. */
export class DevTunnelsBackend implements TunnelBackend {
  readonly id = 'devtunnels';
  readonly bindHost = 'localhost';
  private reconciliation: Promise<void> | undefined;

  constructor(
    private readonly executable: string,
    private readonly runtime: DevTunnelsRuntime,
    private readonly options: {
      readonly provider?: DevTunnelsProvider;
      readonly verbose: boolean;
      readonly readinessTimeoutMs: number;
      readonly ownershipStore: TemporaryTunnelOwnershipStore;
      readonly runId: string;
      readonly processId: number;
      readonly isProcessAlive: (processId: number) => boolean;
      readonly now: () => Date;
    },
  ) {}

  async connect(localPort: number): Promise<TunnelConnection> {
    this.reconciliation ??= reconcileTemporaryTunnels(
      this.runtime,
      this.executable,
      this.options.ownershipStore,
      this.options.runId,
      this.options.isProcessAlive,
    );
    await this.reconciliation;

    try {
      return await this.startHost(localPort);
    } catch (error) {
      const status = await this.runtime.run(this.executable, ['user', 'show'], {
        inheritStdio: false,
      });
      if (hasCachedLogin(status)) throw error;

      await ensureSignedIn(this.runtime, this.executable, this.options.provider, true);
      return this.startHost(localPort);
    }
  }

  private async startHost(localPort: number): Promise<TunnelConnection> {
    const child = this.runtime.spawnHost(this.executable, [
      'host',
      '-p',
      String(localPort),
      '--allow-anonymous',
      '--protocol',
      'http',
    ]);
    let url: string;
    try {
      url = await waitForTunnelUrl(
        child,
        localPort,
        this.options.readinessTimeoutMs,
        this.options.verbose ? (text) => this.runtime.write(text) : undefined,
      );
    } catch (error) {
      await stopHost(child);
      throw error;
    }

    const tunnelId = extractTunnelId(url, localPort);
    if (!tunnelId) {
      await stopHost(child);
      throw new UserFacingError(
        'Dev Tunnels returned a URL without a usable tunnel identity. The temporary tunnel was stopped before Mobily reported it ready.',
      );
    }
    const ownership: TemporaryTunnelOwnership = {
      version: 1,
      tunnelId,
      ownerRunId: this.options.runId,
      ownerProcessId: this.options.processId,
      createdAt: this.options.now().toISOString(),
      state: 'ready',
    };
    try {
      await this.options.ownershipStore.save(ownership);
    } catch (error) {
      await stopHost(child);
      try {
        await deleteTemporaryTunnel(this.runtime, this.executable, tunnelId);
      } catch {
        // The original durable-record failure is authoritative: the tunnel was
        // never reported ready, and helper shutdown still gets its normal
        // chance to remove the temporary resource.
      }
      throw new UserFacingError(
        `Mobily could not record ownership of temporary tunnel '${tunnelId}', so it was not reported ready. ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let disconnected = false;
    return {
      url,
      disconnect: async (signal?: AbortSignal) => {
        if (disconnected) return;
        disconnected = true;
        const deletingOwnership: TemporaryTunnelOwnership = {
          ...ownership,
          state: 'deleting',
        };
        try {
          await this.options.ownershipStore.save(deletingOwnership);
        } catch {
          // Keep cleaning: if deletion fails, the already-durable "ready"
          // record remains sufficient for a later recovery attempt.
        }
        await stopHost(child);
        await deleteTemporaryTunnel(this.runtime, this.executable, tunnelId);
        if (signal?.aborted) return;
        await this.options.ownershipStore.remove(ownership);
      },
    };
  }
}

async function reconcileTemporaryTunnels(
  runtime: DevTunnelsRuntime,
  executable: string,
  ownershipStore: TemporaryTunnelOwnershipStore,
  runId: string,
  ownerIsAlive: (processId: number) => boolean,
): Promise<void> {
  let records: readonly TemporaryTunnelOwnership[];
  try {
    records = await ownershipStore.list();
  } catch {
    throw new UserFacingError(
      'Mobily could not read its Temporary Tunnel recovery records. Check access to ~/.mobily/temporary-tunnels and rerun Mobily before creating another Dev Tunnel.',
    );
  }

  for (const ownership of records) {
    if (
      ownership.ownerRunId === runId ||
      (ownership.ownerProcessId !== undefined && ownerIsAlive(ownership.ownerProcessId))
    ) {
      continue;
    }

    const deletingOwnership: TemporaryTunnelOwnership = {
      ...ownership,
      state: 'deleting',
    };
    try {
      await ownershipStore.save(deletingOwnership);
    } catch {
      throw new UserFacingError(
        `Mobily could not update the recovery record for temporary tunnel '${ownership.tunnelId}'. Check access to ~/.mobily/temporary-tunnels and rerun Mobily; no new Dev Tunnel was created.`,
      );
    }

    await deleteTemporaryTunnel(runtime, executable, ownership.tunnelId, true);
    try {
      await ownershipStore.remove(deletingOwnership);
    } catch {
      throw new UserFacingError(
        `Mobily deleted stale temporary tunnel '${ownership.tunnelId}' but could not remove its recovery record. Check access to ~/.mobily/temporary-tunnels and rerun Mobily; no new Dev Tunnel was created.`,
      );
    }
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitForTunnelUrl(
  child: DevTunnelHostProcess,
  localPort: number,
  timeoutMs: number,
  onOutput?: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';

    const finish = (result: { url?: string; error?: UserFacingError }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result.url) resolve(result.url);
      else reject(result.error);
    };

    const onData = (chunk: string | Buffer): void => {
      const text = chunk.toString();
      onOutput?.(text);
      output = (output + text).slice(-32_768);
      const url = extractTunnelUrl(output, localPort);
      if (url) finish({ url });
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', () => {
      finish({
        error: new UserFacingError(
          'Dev Tunnels could not start. Check that the devtunnel helper is installed and try again.',
        ),
      });
    });
    child.once('exit', (code) => {
      if (settled) return;
      if (isTunnelQuotaError(output)) {
        finish({
          error: new UserFacingError(
            'Dev Tunnels quota is full. Delete unused tunnels with `devtunnel delete-all`, then try again.',
          ),
        });
        return;
      }
      const detail = conciseHelperDetail(output);
      finish({
        error: new UserFacingError(
          `Dev Tunnels stopped before it was ready${code === null ? '' : ` (exit ${code})`}.${detail}`,
        ),
      });
    });

    const timer = setTimeout(() => {
      finish({
        error: new UserFacingError(
          'Dev Tunnels did not become ready within 60 seconds. Check your connection and try again.',
        ),
      });
    }, timeoutMs);
  });
}

function isTunnelQuotaError(output: string): boolean {
  return /\b(?:tunnel quota (?:is )?full|(?:maximum|max) number of (?:dev )?tunnels? (?:has been )?reached|tunnel limit (?:has been )?(?:exceeded|reached))\b/i.test(
    output,
  );
}

function extractTunnelUrl(output: string, localPort: number): string | undefined {
  const matches = output.match(/https:\/\/[^\s,]+\.devtunnels\.ms(?::\d+)?\/?/gi) ?? [];
  const candidates = matches
    .map((value) => value.replace(/[)\]}]+$/, ''))
    .filter((value) => {
      try {
        const url = new URL(value);
        return url.hostname.endsWith('.devtunnels.ms') && !url.hostname.includes('-inspect.');
      } catch {
        return false;
      }
    });
  const selected =
    candidates.find((value) => new URL(value).hostname.includes(`-${localPort}.`)) ?? candidates[0];
  if (!selected) return undefined;
  const url = new URL(selected);
  url.protocol = 'wss:';
  return url.toString();
}

function extractTunnelId(tunnelUrl: string, localPort: number): string | undefined {
  const url = new URL(tunnelUrl);
  const tunnelPortLabel = url.hostname.split('.')[0];
  const portSuffix = `-${localPort}`;
  if (tunnelPortLabel?.endsWith(portSuffix)) {
    return tunnelPortLabel.slice(0, -portSuffix.length);
  }
  return url.port === String(localPort) ? tunnelPortLabel : undefined;
}

async function deleteTemporaryTunnel(
  runtime: DevTunnelsRuntime,
  executable: string,
  tunnelId: string,
  recovery = false,
): Promise<void> {
  const deletion = await runtime.run(executable, ['delete', tunnelId], { inheritStdio: false });
  if (deletion.exitCode === 0 || isMissingTunnel(deletion)) return;
  throw new UserFacingError(
    `Dev Tunnels could not delete temporary tunnel '${tunnelId}'. Run \`devtunnel delete ${tunnelId}\`, then rerun Mobily.${recovery ? ' No new Dev Tunnel was created.' : ''}`,
  );
}

function isMissingTunnel(result: CommandResult): boolean {
  return /\b(not found|does not exist|could not be found)\b/i.test(
    `${result.stdout}\n${result.stderr}`,
  );
}

function conciseHelperDetail(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  const sanitized = line?.replace(/^error:?\s*/i, '').replace(/^\s*at\s+/, '');
  return sanitized ? ` ${sanitized.slice(0, 240)}` : '';
}

async function stopHost(child: DevTunnelHostProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exitPromise = new Promise<true>((resolve) => child.once('exit', () => resolve(true)));
  // Dev Tunnels documents Ctrl-C as the graceful shutdown path that removes
  // the temporary tunnel resource created by `devtunnel host -p`.
  child.kill('SIGINT');
  const exited = await Promise.race([
    exitPromise,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), HOST_SHUTDOWN_TIMEOUT_MS)),
  ]);
  if (!exited && child.exitCode === null) child.kill('SIGKILL');
}

function installMessage(platform: NodeJS.Platform): string {
  const command =
    platform === 'win32'
      ? 'winget install Microsoft.devtunnel'
      : platform === 'darwin'
        ? 'brew install --cask devtunnel'
        : 'curl -sL https://aka.ms/DevTunnelCliInstall | bash';
  return (
    'Microsoft Dev Tunnels needs the devtunnel helper. Install it with:\n' +
    `  ${command}\n` +
    'Then run Mobily again.'
  );
}

function createNodeRuntime(): DevTunnelsRuntime {
  const homeDir = os.homedir();
  return {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    platform: process.platform,
    findExecutable: () => findDevTunnelExecutable(process.platform, homeDir, process.env),
    run: runCommand,
    spawnHost: (executable, args) =>
      spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'] }),
    prompt: async (message) => {
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await readline.question(message);
      } finally {
        readline.close();
      }
    },
    write: (message) => process.stdout.write(message),
  };
}

export function findDevTunnelExecutable(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  fileExists: (candidate: string) => boolean = existsSync,
): string | undefined {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const filename = platform === 'win32' ? 'devtunnel.exe' : 'devtunnel';
  const pathCandidates = (env.PATH ?? '')
    .split(pathApi.delimiter)
    .filter(Boolean)
    .map((directory) => pathApi.join(directory, filename));
  const commonCandidates =
    platform === 'win32'
      ? [
          env.LOCALAPPDATA
            ? pathApi.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', filename)
            : '',
        ]
      : [
          pathApi.join(homeDir, 'bin', filename),
          pathApi.join(homeDir, '.local', 'bin', filename),
          '/usr/local/bin/devtunnel',
          '/opt/homebrew/bin/devtunnel',
        ];
  return [...pathCandidates, ...commonCandidates].find(
    (candidate) => candidate.length > 0 && fileExists(candidate),
  );
}

async function runCommand(
  executable: string,
  args: readonly string[],
  options: { inheritStdio: boolean },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...args], {
      stdio: options.inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    if (child.stderr) child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', (error) => resolve({ exitCode: 1, stdout, stderr: error.message }));
    child.once('exit', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}
