import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { UserFacingError } from '../src/errors.js';
import {
  findDevTunnelExecutable,
  prepareDevTunnelsBackend,
  type CommandResult,
  type DevTunnelHostProcess,
  type DevTunnelsRuntime,
  type PrepareDevTunnelsOptions,
} from '../src/tunnel/devtunnels.js';
import { LocalBackend } from '../src/tunnel/local.js';
import {
  FileTemporaryTunnelOwnershipStore,
  type TemporaryTunnelOwnership,
  type TemporaryTunnelOwnershipStore,
} from '../src/tunnel/temporaryTunnelOwnership.js';

class FakeHostProcess extends EventEmitter implements DevTunnelHostProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  readonly signals: Array<NodeJS.Signals | number | undefined> = [];
  autoExitOnKill = true;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    if (this.autoExitOnKill) {
      this.exitCode = 0;
      queueMicrotask(() => this.emit('exit', 0, signal ?? null));
    }
    return true;
  }

  exit(code: number): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

class FakeOwnershipStore implements TemporaryTunnelOwnershipStore {
  readonly records = new Map<string, TemporaryTunnelOwnership>();
  readonly events: Array<{ action: 'save' | 'remove'; ownership: TemporaryTunnelOwnership }> = [];
  saveError: Error | undefined;
  removeError: Error | undefined;

  async list(): Promise<readonly TemporaryTunnelOwnership[]> {
    return [...this.records.values()];
  }

  async save(ownership: TemporaryTunnelOwnership): Promise<void> {
    if (this.saveError) throw this.saveError;
    this.events.push({ action: 'save', ownership });
    this.records.set(this.key(ownership), ownership);
  }

  async remove(ownership: TemporaryTunnelOwnership): Promise<void> {
    if (this.removeError) throw this.removeError;
    this.events.push({ action: 'remove', ownership });
    this.records.delete(this.key(ownership));
  }

  private key(ownership: TemporaryTunnelOwnership): string {
    return `${ownership.ownerRunId}:${ownership.tunnelId}`;
  }
}

class FakeRuntime implements DevTunnelsRuntime {
  interactive = false;
  platform: NodeJS.Platform = 'linux';
  executable: string | undefined = '/home/tester/bin/devtunnel';
  readonly calls: Array<{ args: readonly string[]; inheritStdio: boolean }> = [];
  readonly hostCalls: Array<{ args: readonly string[]; process: FakeHostProcess }> = [];
  readonly prompts: string[] = [];
  readonly output: string[] = [];
  readonly results: CommandResult[] = [];
  readonly promptAnswers: string[] = [];
  readonly hosts: FakeHostProcess[] = [];
  readonly ownershipStore = new FakeOwnershipStore();
  findCount = 0;

  findExecutable(): string | undefined {
    this.findCount += 1;
    return this.executable;
  }

  async run(
    _executable: string,
    args: readonly string[],
    options: { inheritStdio: boolean },
  ): Promise<CommandResult> {
    this.calls.push({ args, inheritStdio: options.inheritStdio });
    return this.results.shift() ?? { exitCode: 0, stdout: '', stderr: '' };
  }

  spawnHost(_executable: string, args: readonly string[]): DevTunnelHostProcess {
    const process = this.hosts.shift() ?? new FakeHostProcess();
    this.hostCalls.push({ args, process });
    return process;
  }

  async prompt(message: string): Promise<string> {
    this.prompts.push(message);
    return this.promptAnswers.shift() ?? '';
  }

  write(message: string): void {
    this.output.push(message);
  }
}

function prepareFakeBackend(
  runtime: FakeRuntime,
  options: Omit<PrepareDevTunnelsOptions, 'runtime' | 'ownershipStore'> = {},
) {
  return prepareDevTunnelsBackend({
    processId: 4242,
    ...options,
    runtime,
    ownershipStore: runtime.ownershipStore,
  });
}

describe('prepareDevTunnelsBackend()', () => {
  it('reports an actionable install command without exposing a configuration error', async () => {
    const runtime = new FakeRuntime();
    runtime.executable = undefined;

    await expect(prepareDevTunnelsBackend({ runtime })).rejects.toEqual(
      new UserFacingError(
        'Microsoft Dev Tunnels needs the devtunnel helper. Install it with:\n' +
          '  curl -sL https://aka.ms/DevTunnelCliInstall | bash\n' +
          'Then run Mobily again.',
      ),
    );
  });

  it('retries helper discovery after guided interactive installation', async () => {
    const runtime = new FakeRuntime();
    runtime.interactive = true;
    runtime.executable = undefined;
    runtime.promptAnswers.push('');
    const originalFind = runtime.findExecutable.bind(runtime);
    runtime.findExecutable = () => {
      const value = originalFind();
      if (runtime.findCount === 1) runtime.executable = '/home/tester/bin/devtunnel';
      return value;
    };

    const backend = await prepareDevTunnelsBackend({ runtime });

    expect(backend.id).toBe('devtunnels');
    expect(runtime.findCount).toBe(2);
    expect(runtime.output.join('')).toContain('DevTunnelCliInstall');
  });

  it('uses cached credentials without prompting for login', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push({ exitCode: 0, stdout: 'Logged in', stderr: '' });

    await prepareDevTunnelsBackend({ runtime });

    expect(runtime.calls).toEqual([{ args: ['user', 'show'], inheritStdio: false }]);
    expect(runtime.prompts).toEqual([]);
  });

  it('defaults interactive first-time login to GitHub', async () => {
    const runtime = new FakeRuntime();
    runtime.interactive = true;
    runtime.results.push(
      { exitCode: 1, stdout: '', stderr: 'Not logged in' },
      { exitCode: 0, stdout: '', stderr: '' },
    );
    runtime.promptAnswers.push('');

    await prepareDevTunnelsBackend({ runtime });

    expect(runtime.calls[1]).toEqual({
      args: ['user', 'login', '-g', '-d'],
      inheritStdio: true,
    });
  });

  it('does not mistake a successful logged-out status command for cached credentials', async () => {
    const runtime = new FakeRuntime();
    runtime.interactive = true;
    runtime.results.push(
      { exitCode: 0, stdout: 'Not logged in.', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    );
    runtime.promptAnswers.push('');

    await prepareDevTunnelsBackend({ runtime });

    expect(runtime.calls[1]?.args).toEqual(['user', 'login', '-g', '-d']);
  });

  it('runs Microsoft device-code login when selected by flag', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 1, stdout: '', stderr: 'Not logged in' },
      { exitCode: 0, stdout: '', stderr: '' },
    );

    await prepareDevTunnelsBackend({ runtime, provider: 'microsoft' });

    expect(runtime.calls[1]).toEqual({
      args: ['user', 'login', '-d'],
      inheritStdio: true,
    });
  });

  it('requires an explicit provider when first-time login is non-interactive', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push({ exitCode: 1, stdout: '', stderr: 'Not logged in' });

    await expect(prepareDevTunnelsBackend({ runtime })).rejects.toThrow(
      '--devtunnels-provider github',
    );
  });

  it('reports a cancelled account prompt as a user-facing failure', async () => {
    const runtime = new FakeRuntime();
    runtime.interactive = true;
    runtime.results.push({ exitCode: 1, stdout: '', stderr: 'Not logged in' });
    vi.spyOn(runtime, 'prompt').mockRejectedValue(new Error('readline was closed'));

    await expect(prepareDevTunnelsBackend({ runtime })).rejects.toEqual(
      new UserFacingError('Dev Tunnels setup was cancelled. Run Mobily again when ready.'),
    );
  });

  it('turns login denial or an incompatible helper into a user-facing failure', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 2, stdout: '', stderr: 'Unknown command or not logged in' },
      { exitCode: 1, stdout: '', stderr: 'Access denied' },
    );

    await expect(prepareDevTunnelsBackend({ runtime, provider: 'github' })).rejects.toEqual(
      new UserFacingError(
        'Dev Tunnels sign-in was not completed. Run Mobily again when you are ready to sign in.',
      ),
    );
  });
});

describe('findDevTunnelExecutable()', () => {
  it('discovers the Linux installer location under ~/bin', () => {
    const expected = '/home/tester/bin/devtunnel';
    expect(
      findDevTunnelExecutable(
        'linux',
        '/home/tester',
        { PATH: '' },
        (candidate) => candidate === expected,
      ),
    ).toBe(expected);
  });

  it('discovers the Windows WinGet links location', () => {
    const expected = 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WinGet\\Links\\devtunnel.exe';
    expect(
      findDevTunnelExecutable(
        'win32',
        'C:\\Users\\tester',
        { PATH: '', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
        (candidate) => candidate === expected,
      ),
    ).toBe(expected);
  });

  it('discovers the Homebrew location on macOS', () => {
    const expected = '/opt/homebrew/bin/devtunnel';
    expect(
      findDevTunnelExecutable(
        'darwin',
        '/Users/tester',
        { PATH: '' },
        (candidate) => candidate === expected,
      ),
    ).toBe(expected);
  });
});

describe('FileTemporaryTunnelOwnershipStore', () => {
  it('atomically replaces lifecycle state and removes the exact ownership record', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'mobily-tunnel-ownership-'));
    const store = new FileTemporaryTunnelOwnershipStore(directory);
    const ownership: TemporaryTunnelOwnership = {
      version: 1,
      tunnelId: 'abc',
      ownerRunId: 'run-123',
      createdAt: '2026-07-21T07:00:00.000Z',
      state: 'ready',
    };

    try {
      await store.save(ownership);
      const [recordFile] = readdirSync(directory);
      expect(recordFile).toMatch(/^[a-f0-9]{64}\.json$/);
      await expect(store.list()).resolves.toEqual([ownership]);
      expect(JSON.parse(readFileSync(path.join(directory, recordFile!), 'utf8'))).toEqual(
        ownership,
      );

      const deletingOwnership: TemporaryTunnelOwnership = {
        ...ownership,
        state: 'deleting',
      };
      await store.save(deletingOwnership);
      expect(readdirSync(directory)).toEqual([recordFile]);
      expect(JSON.parse(readFileSync(path.join(directory, recordFile!), 'utf8'))).toEqual(
        deletingOwnership,
      );

      await store.remove(deletingOwnership);
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('Temporary Tunnel startup recovery', () => {
  const staleOwnership = (
    overrides: Partial<TemporaryTunnelOwnership> = {},
  ): TemporaryTunnelOwnership => ({
    version: 1,
    tunnelId: 'stale-tunnel',
    ownerRunId: 'stale-run',
    ownerProcessId: 111,
    createdAt: '2026-07-21T06:00:00.000Z',
    state: 'ready',
    ...overrides,
  });

  it('deletes stale recorded tunnels before creating a new Dev Tunnel', async () => {
    const runtime = new FakeRuntime();
    await runtime.ownershipStore.save(staleOwnership());
    runtime.ownershipStore.events.length = 0;
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    );

    const backend = await prepareFakeBackend(runtime, {
      runId: 'current-run',
      isProcessAlive: () => false,
    });

    expect(runtime.calls.map((call) => call.args)).toEqual([['user', 'show']]);
    expect(runtime.hostCalls).toHaveLength(0);

    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const connecting = backend.connect(4321);
    host.stdout.write('https://new-tunnel-4321.usw2.devtunnels.ms/');
    await expect(connecting).resolves.toMatchObject({
      url: 'wss://new-tunnel-4321.usw2.devtunnels.ms/',
    });
    expect(runtime.calls.map((call) => call.args)).toEqual([
      ['user', 'show'],
      ['delete', 'stale-tunnel'],
    ]);
    expect(runtime.ownershipStore.records.size).toBe(1);
  });

  it('protects a recorded tunnel whose owning CLI process is still live', async () => {
    const runtime = new FakeRuntime();
    await runtime.ownershipStore.save(staleOwnership({ tunnelId: 'live-tunnel' }));
    runtime.ownershipStore.events.length = 0;

    const backend = await prepareFakeBackend(runtime, {
      runId: 'current-run',
      isProcessAlive: (processId) => processId === 111,
    });
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const connecting = backend.connect(4321);
    host.stdout.write('https://current-4321.usw2.devtunnels.ms/');
    await connecting;

    expect(runtime.calls.map((call) => call.args)).toEqual([['user', 'show']]);
    expect([...runtime.ownershipStore.records.values()]).toContainEqual(
      staleOwnership({ tunnelId: 'live-tunnel' }),
    );
  });

  it('treats a missing stale tunnel as cleaned and removes its record', async () => {
    const runtime = new FakeRuntime();
    await runtime.ownershipStore.save(staleOwnership());
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 1, stdout: '', stderr: 'Tunnel was not found' },
    );

    const backend = await prepareFakeBackend(runtime, { isProcessAlive: () => false });
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const connecting = backend.connect(4321);
    host.stdout.write('https://current-4321.usw2.devtunnels.ms/');

    await expect(connecting).resolves.toMatchObject({
      url: 'wss://current-4321.usw2.devtunnels.ms/',
    });
    expect([...runtime.ownershipStore.records.values()]).toMatchObject([
      { tunnelId: 'current', ownerRunId: expect.any(String) },
    ]);
  });

  it('retains the record and blocks creation when stale cleanup fails', async () => {
    const runtime = new FakeRuntime();
    await runtime.ownershipStore.save(staleOwnership());
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 1, stdout: '', stderr: 'Bearer super-secret-token' },
    );

    const backend = await prepareFakeBackend(runtime, { isProcessAlive: () => false });
    const expectedError = new UserFacingError(
      "Dev Tunnels could not delete temporary tunnel 'stale-tunnel'. Run `devtunnel delete stale-tunnel`, then rerun Mobily. No new Dev Tunnel was created.",
    );

    await expect(backend.connect(4321)).rejects.toEqual(expectedError);
    await expect(backend.connect(4321)).rejects.toEqual(expectedError);
    expect(runtime.hostCalls).toHaveLength(0);
    expect([...runtime.ownershipStore.records.values()]).toMatchObject([
      { tunnelId: 'stale-tunnel', state: 'deleting' },
    ]);

    const local = new LocalBackend({
      key: 'key',
      cert: 'cert',
      certificatePin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    await expect(local.connect(4321)).resolves.toMatchObject({
      url: expect.stringMatching(/^wss:/),
    });
  });
});

describe('DevTunnelsBackend', () => {
  it('hosts the local HTTP port and returns the port-specific secure WebSocket URL', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime, {
      runId: 'run-123',
      now: () => new Date('2026-07-21T07:00:00.000Z'),
    });

    const connecting = backend.connect(4321);
    host.stdout.write(
      'Hosting port 4321 at https://abc.usw2.devtunnels.ms:4321/, ' +
        'https://abc-4321.usw2.devtunnels.ms/ and ' +
        'https://abc-4321-inspect.usw2.devtunnels.ms/\n',
    );
    const connection = await connecting;

    expect(runtime.hostCalls[0]?.args).toEqual([
      'host',
      '-p',
      '4321',
      '--allow-anonymous',
      '--protocol',
      'http',
    ]);
    expect(connection.url).toBe('wss://abc-4321.usw2.devtunnels.ms/');
    expect(runtime.ownershipStore.events).toEqual([
      {
        action: 'save',
        ownership: {
          version: 1,
          tunnelId: 'abc',
          ownerRunId: 'run-123',
          ownerProcessId: 4242,
          createdAt: '2026-07-21T07:00:00.000Z',
          state: 'ready',
        },
      },
    ]);
  });

  it('does not report a tunnel ready when durable ownership recording fails', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    );
    runtime.ownershipStore.saveError = new Error('disk unavailable');
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime, { runId: 'run-record-failure' });

    const connecting = backend.connect(4321);
    host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');

    await expect(connecting).rejects.toThrow(
      "could not record ownership of temporary tunnel 'abc'",
    );
    expect(host.signals).toEqual(['SIGINT']);
    expect(runtime.calls.map((call) => call.args)).toContainEqual(['delete', 'abc']);
  });

  it.each(['linux', 'win32'] as const)(
    'interrupts the helper and explicitly deletes its temporary tunnel on %s',
    async (platform) => {
      const runtime = new FakeRuntime();
      runtime.platform = platform;
      const host = new FakeHostProcess();
      runtime.hosts.push(host);
      const backend = await prepareFakeBackend(runtime);
      const connecting = backend.connect(4321);
      host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
      const connection = await connecting;

      await connection.disconnect();

      expect(host.signals).toEqual(['SIGINT']);
      expect(runtime.calls.at(-1)).toEqual({
        args: ['delete', 'abc'],
        inheritStdio: false,
      });
      expect(runtime.ownershipStore.records.size).toBe(0);
    },
  );

  it('preserves the ownership record when forced shutdown aborts cleanup', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime);
    const connecting = backend.connect(4321);
    host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
    const connection = await connecting;
    const shutdown = new AbortController();
    shutdown.abort();

    await connection.disconnect(shutdown.signal);

    expect([...runtime.ownershipStore.records.values()]).toMatchObject([
      { tunnelId: 'abc', state: 'deleting' },
    ]);
  });

  it('reports a temporary tunnel that could not be deleted', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 1, stdout: '', stderr: 'Error: service unavailable' },
    );
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime);
    const connecting = backend.connect(4321);
    host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
    const connection = await connecting;

    await expect(connection.disconnect()).rejects.toEqual(
      new UserFacingError(
        "Dev Tunnels could not delete temporary tunnel 'abc'. Run `devtunnel delete abc`, then rerun Mobily.",
      ),
    );
    expect([...runtime.ownershipStore.records.values()]).toMatchObject([
      { tunnelId: 'abc', state: 'deleting' },
    ]);
  });

  it('accepts a temporary tunnel that graceful shutdown already deleted', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 1, stdout: '', stderr: 'Error: Tunnel abc was not found.' },
    );
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime);
    const connecting = backend.connect(4321);
    host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
    const connection = await connecting;

    await expect(connection.disconnect()).resolves.toBeUndefined();
    expect(runtime.ownershipStore.records.size).toBe(0);
  });

  it('deletes only the tunnel owned by this connection', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    );
    await runtime.ownershipStore.save({
      version: 1,
      tunnelId: 'other-user-tunnel',
      ownerRunId: 'other-run',
      ownerProcessId: 999,
      createdAt: '2026-07-21T06:00:00.000Z',
      state: 'ready',
    });
    runtime.ownershipStore.events.length = 0;
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime, {
      runId: 'current-run',
      isProcessAlive: (processId) => processId === 999,
    });
    const connecting = backend.connect(4321);
    host.stdout.write('https://owned-4321.usw2.devtunnels.ms/');
    const connection = await connecting;

    await connection.disconnect();

    expect(runtime.calls.filter((call) => call.args[0] === 'delete')).toEqual([
      { args: ['delete', 'owned'], inheritStdio: false },
    ]);
    expect([...runtime.ownershipStore.records.values()]).toMatchObject([
      { tunnelId: 'other-user-tunnel', ownerRunId: 'other-run' },
    ]);
  });

  it('times out with a user-facing error when the helper never becomes ready', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime, {
      readinessTimeoutMs: 5,
    });

    await expect(backend.connect(4321)).rejects.toThrow('did not become ready within 60 seconds');
    expect(host.signals).toContain('SIGINT');
  });

  it('reports an early helper exit without a stack-oriented error', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime);

    const connecting = backend.connect(4321);
    await vi.waitFor(() => expect(runtime.hostCalls).toHaveLength(1));
    host.stderr.write('Error: unsupported helper version\n');
    host.exit(2);

    await expect(connecting).rejects.toEqual(
      new UserFacingError(
        'Dev Tunnels stopped before it was ready (exit 2). unsupported helper version',
      ),
    );
  });

  it('explains how to clear unused tunnels when the account quota is full', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareFakeBackend(runtime);

    const connecting = backend.connect(4321);
    await vi.waitFor(() => expect(runtime.hostCalls).toHaveLength(1));
    host.stderr.write('Error: The maximum number of tunnels has been reached.\n');
    host.exit(1);

    await expect(connecting).rejects.toEqual(
      new UserFacingError(
        'Dev Tunnels quota is full. Delete unused tunnels with `devtunnel delete-all`, then try again.',
      ),
    );
  });

  it('force-terminates a helper that ignores graceful shutdown', async () => {
    vi.useFakeTimers();
    try {
      const runtime = new FakeRuntime();
      const host = new FakeHostProcess();
      host.autoExitOnKill = false;
      runtime.hosts.push(host);
      const backend = await prepareFakeBackend(runtime);
      const connecting = backend.connect(4321);
      host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
      const connection = await connecting;

      const disconnecting = connection.disconnect();
      await vi.advanceTimersByTimeAsync(5_000);
      await disconnecting;

      expect(host.signals).toEqual(['SIGINT', 'SIGKILL']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signs in once and retries when cached credentials expire before hosting', async () => {
    const runtime = new FakeRuntime();
    runtime.interactive = true;
    runtime.results.push(
      { exitCode: 0, stdout: 'Initially logged in', stderr: '' },
      { exitCode: 0, stdout: 'Token expired', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    );
    runtime.promptAnswers.push('');
    const firstHost = new FakeHostProcess();
    const secondHost = new FakeHostProcess();
    runtime.hosts.push(firstHost, secondHost);
    const backend = await prepareFakeBackend(runtime);

    const connecting = backend.connect(4321);
    await vi.waitFor(() => expect(runtime.hostCalls).toHaveLength(1));
    firstHost.exit(1);
    await vi.waitFor(() => expect(runtime.hostCalls).toHaveLength(2));
    secondHost.stdout.write('https://abc-4321.usw2.devtunnels.ms/');

    await expect(connecting).resolves.toMatchObject({
      url: 'wss://abc-4321.usw2.devtunnels.ms/',
    });
    expect(runtime.calls.at(-1)).toEqual({
      args: ['user', 'login', '-g', '-d'],
      inheritStdio: true,
    });
    expect(runtime.hostCalls).toHaveLength(2);
  });
});
