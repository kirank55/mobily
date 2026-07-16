import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { UserFacingError } from '../src/errors.js';
import {
  findDevTunnelExecutable,
  prepareDevTunnelsBackend,
  type CommandResult,
  type DevTunnelHostProcess,
  type DevTunnelsRuntime,
} from '../src/tunnel/devtunnels.js';

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

describe('DevTunnelsBackend', () => {
  it('hosts the local HTTP port and returns the port-specific secure WebSocket URL', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareDevTunnelsBackend({ runtime });

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
  });

  it.each(['linux', 'win32'] as const)(
    'interrupts the helper and explicitly deletes its temporary tunnel on %s',
    async (platform) => {
      const runtime = new FakeRuntime();
      runtime.platform = platform;
      const host = new FakeHostProcess();
      runtime.hosts.push(host);
      const backend = await prepareDevTunnelsBackend({ runtime });
      const connecting = backend.connect(4321);
      host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
      const connection = await connecting;

      await connection.disconnect();

      expect(host.signals).toEqual(['SIGINT']);
      expect(runtime.calls.at(-1)).toEqual({
        args: ['delete', 'abc'],
        inheritStdio: false,
      });
    },
  );

  it('reports a temporary tunnel that could not be deleted', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 1, stdout: '', stderr: 'Error: service unavailable' },
    );
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareDevTunnelsBackend({ runtime });
    const connecting = backend.connect(4321);
    host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
    const connection = await connecting;

    await expect(connection.disconnect()).rejects.toEqual(
      new UserFacingError(
        "Dev Tunnels could not delete temporary tunnel 'abc'. Delete it with `devtunnel delete abc` before starting Mobily again. service unavailable",
      ),
    );
  });

  it('accepts a temporary tunnel that graceful shutdown already deleted', async () => {
    const runtime = new FakeRuntime();
    runtime.results.push(
      { exitCode: 0, stdout: 'Logged in', stderr: '' },
      { exitCode: 1, stdout: '', stderr: 'Error: Tunnel abc was not found.' },
    );
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareDevTunnelsBackend({ runtime });
    const connecting = backend.connect(4321);
    host.stdout.write('https://abc-4321.usw2.devtunnels.ms/');
    const connection = await connecting;

    await expect(connection.disconnect()).resolves.toBeUndefined();
  });

  it('times out with a user-facing error when the helper never becomes ready', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareDevTunnelsBackend({
      runtime,
      readinessTimeoutMs: 5,
    });

    await expect(backend.connect(4321)).rejects.toThrow('did not become ready within 60 seconds');
    expect(host.signals).toContain('SIGINT');
  });

  it('reports an early helper exit without a stack-oriented error', async () => {
    const runtime = new FakeRuntime();
    const host = new FakeHostProcess();
    runtime.hosts.push(host);
    const backend = await prepareDevTunnelsBackend({ runtime });

    const connecting = backend.connect(4321);
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
    const backend = await prepareDevTunnelsBackend({ runtime });

    const connecting = backend.connect(4321);
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
      const backend = await prepareDevTunnelsBackend({ runtime });
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
    const backend = await prepareDevTunnelsBackend({ runtime });

    const connecting = backend.connect(4321);
    queueMicrotask(() => firstHost.exit(1));
    setTimeout(() => secondHost.stdout.write('https://abc-4321.usw2.devtunnels.ms/'), 0);

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
