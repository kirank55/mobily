import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDisposable, PtyProcess } from '../src/pty/node-pty.js';
import { BareBackend } from '../src/mux/bare.js';
import {
  createSessionBackend,
  defaultSessionName,
  exitCurrentMobily,
  hideCurrentQrPanel,
  isTmuxAvailable,
  killTmuxSession,
  validateSessionName,
  type SessionRuntime,
} from '../src/mux/factory.js';
import {
  clearShellPane,
  printShellPaneLines,
  resizePairingPanel,
  resizePairingPanelLines,
  TmuxBackend,
} from '../src/mux/tmux.js';
import {
  CONNECTED_WORKSTATION_PANEL,
  CONNECTED_WORKSTATION_PANEL_HEIGHT,
} from '../src/tmuxWorkstationAttach.js';
import { defaultSessionRuntime } from '../src/mux/runtime.js';

class FakePty implements PtyProcess {
  readonly raw = {} as PtyProcess['raw'];
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly dataListeners = new Set<(data: string) => void>();
  readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  killed = false;

  write(data: string): void {
    this.writes.push(data);
  }

  onData(listener: (data: string) => void): IDisposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }

  kill(): void {
    this.killed = true;
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): IDisposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
}

function runtime(overrides: Partial<SessionRuntime> = {}): {
  value: SessionRuntime;
  pty: FakePty;
  commands: Array<{ file: string; args: string[] }>;
} {
  const pty = new FakePty();
  const commands: Array<{ file: string; args: string[] }> = [];
  return {
    pty,
    commands,
    value: {
      spawnPty: vi.fn(() => pty),
      execFile: vi.fn((file: string, args: string[]) => {
        commands.push({ file, args });
        if (args[0] === 'capture-pane') return 'captured-one\ncaptured-two\n';
        return '';
      }),
      canonicalize: (path) => path,
      ...overrides,
    },
  };
}

describe('BareBackend', () => {
  it('provides terminal I/O and bounded trailing-line replay through the backend seam', () => {
    const fake = runtime();
    const backend = new BareBackend({ cwd: '/workspace', scrollbackBytes: 32 }, fake.value);
    const received: string[] = [];
    backend.onData((data) => received.push(data));

    fake.pty.emit('one\ntwo\n');
    fake.pty.emit('three\n');
    backend.write('echo ready\r');
    backend.resize(120, 40);

    expect(received).toEqual(['one\ntwo\n', 'three\n']);
    expect(backend.readScrollback(2)).toBe('two\nthree\n');
    expect(fake.pty.writes).toEqual(['echo ready\r']);
    expect(fake.pty.resizes).toEqual([[120, 40]]);
    expect(backend.kind).toBe('bare');
    expect(backend.attachCommand).toBeNull();

    backend.dispose();
    expect(fake.pty.killed).toBe(true);
  });

  it('captures the full bounded transcript instead of the trailing replay window', () => {
    const fake = runtime();
    const backend = new BareBackend({ scrollbackBytes: 64 * 1024 }, fake.value);
    const transcript =
      '\u001b[?1049h' +
      Array.from({ length: 501 }, (_, index) => `visible-state-${index}\n`).join('');

    fake.pty.emit(transcript);

    expect(backend.readScrollback()).not.toContain('\u001b[?1049h');
    expect(backend.captureVisibleScreen()).toBe(transcript);
    backend.dispose();
  });
});

describe('TmuxBackend', () => {
  it('creates, configures, captures, and attaches a named session without a shell', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'has-session') throw new Error('missing');
        if (args[0] === 'capture-pane') return 'captured\n';
        if (args[0] === 'display-message') return '1\t4\t6\t0\tbar\t0\n';
        if (args[0] === 'split-window') return '%9\n';
        if (args[0] === 'list-panes') return '%0 \n%9 qr\n';
        return '';
      }),
    });

    const backend = new TmuxBackend(
      { cwd: '/workspace', sessionName: 'mobily-work-1234' },
      fake.value,
    );

    expect(fake.commands).toEqual(
      expect.arrayContaining([
        { file: 'tmux', args: ['has-session', '-t', 'mobily-work-1234'] },
        {
          file: 'tmux',
          args: ['new-session', '-d', '-s', 'mobily-work-1234', '-c', '/workspace'],
        },
        {
          file: 'tmux',
          args: ['set-window-option', '-t', 'mobily-work-1234', 'window-size', 'largest'],
        },
        {
          file: 'tmux',
          args: ['set-option', '-t', 'mobily-work-1234', 'status', 'off'],
        },
        {
          file: 'tmux',
          args: ['capture-pane', '-p', '-J', '-S', '-500', '-t', 'mobily-work-1234'],
        },
      ]),
    );
    expect(fake.value.spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({
        file: 'tmux',
        args: ['-T', 'RGB', 'attach-session', '-t', 'mobily-work-1234'],
      }),
    );
    expect(backend.readScrollback()).toContain('captured');
    expect(backend.captureVisibleScreen()).toContain(
      '\u001b[?1049h\u001b[2J\u001b[H\u001b[1;1Hcaptured\u001b[0m\u001b[6 q\u001b[7;5H\u001b[?25l',
    );
    expect(backend.attachCommand).toBe('tmux attach-session -t mobily-work-1234');
    expect(fake.commands.some(({ args }) => args[0] === 'send-keys' && args.includes('-l'))).toBe(
      true,
    );

    backend.showPairingPanel('QR AND CODE', 10);
    expect(fake.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'tmux',
          args: expect.arrayContaining(['split-window', '-l', '1']),
        }),
        { file: 'tmux', args: ['set-option', '-p', '-t', '%9', '@mobily_role', 'qr'] },
        { file: 'tmux', args: ['set-option', '-p', '-t', '%9', '@mobily_panel_lines', '1'] },
        { file: 'tmux', args: ['select-pane', '-t', '%9', '-d'] },
        { file: 'tmux', args: ['resize-pane', '-t', '%9', '-y', '1'] },
        { file: 'tmux', args: ['select-pane', '-t', '%0'] },
      ]),
    );
    expect(
      fake.commands
        .filter(({ args }) => args[0] === 'set-hook' && args[3] !== '-u')
        .map(({ args }) => args[3]),
    ).toEqual(['client-resized', 'client-attached']);
    expect(
      fake.commands.some(
        ({ args }) =>
          args[0] === 'set-hook' &&
          typeof args[4] === 'string' &&
          args[4].includes("sh '") &&
          args[4].includes('>/dev/null 2>&1'),
      ),
    ).toBe(true);

    backend.dispose();
    expect(fake.pty.killed).toBe(true);
    expect(fake.commands.some(({ args }) => args[0] === 'kill-session')).toBe(false);
  });

  it('does not rewrite the prompt when resuming an existing session', () => {
    const fake = runtime();
    const backend = new TmuxBackend(
      { cwd: '/workspace', sessionName: 'mobily-existing' },
      fake.value,
    );
    expect(fake.commands.some(({ args }) => args[0] === 'send-keys')).toBe(false);
    backend.dispose();
  });

  it('hides the marked QR pane in the current tmux session', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'display-message') return 'mobily-work-1234\n';
        if (args[0] === 'list-panes') return '%1 shell\n%2 qr\n';
        return '';
      }),
    });
    expect(hideCurrentQrPanel(fake.value)).toBe(true);
    expect(fake.commands).toContainEqual({ file: 'tmux', args: ['kill-pane', '-t', '%2'] });
  });

  it('resizes the marked QR pane toward a vertical share of the window', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'list-panes') return '%1 shell\n%2 qr\n';
        return '';
      }),
    });
    expect(resizePairingPanel('mobily-work-1234', 50, fake.value)).toBe(true);
    expect(fake.commands).toContainEqual({
      file: 'tmux',
      args: ['resize-pane', '-t', '%2', '-y', '50%'],
    });
  });

  it('clamps the marked QR pane to an exact row count', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'list-panes') return '%1 shell\n%2 qr\n';
        return '';
      }),
    });
    expect(resizePairingPanelLines('mobily-work-1234', 2, fake.value)).toBe(true);
    expect(fake.commands).toContainEqual({
      file: 'tmux',
      args: ['resize-pane', '-t', '%2', '-y', '2'],
    });
  });

  it('clears the shell pane and its scrollback without touching the QR pane', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'list-panes') return '%1 shell\n%2 qr\n';
        return '';
      }),
    });
    expect(clearShellPane('mobily-work-1234', fake.value)).toBe(true);
    expect(fake.commands).toEqual(
      expect.arrayContaining([
        { file: 'tmux', args: ['send-keys', '-t', '%1', '-l', 'clear'] },
        { file: 'tmux', args: ['send-keys', '-t', '%1', 'Enter'] },
        { file: 'tmux', args: ['clear-history', '-t', '%1'] },
      ]),
    );
    expect(fake.commands.some(({ args }) => args.includes('%2') && args[0] === 'send-keys')).toBe(
      false,
    );
  });

  it('writes a formatted banner to the pane TTY without typing a command into the shell', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'list-panes') return '%1 shell\n%2 qr\n';
        if (args[0] === 'display-message') return '/dev/pts/42\t80\n';
        return '';
      }),
    });
    expect(
      printShellPaneLines(
        'mobily-work-1234',
        ['Connected Successfully', 'Run mobily -h for help. Run mobily exit to exit'],
        fake.value,
      ),
    ).toBe(true);
    expect(fake.commands).toContainEqual({
      file: 'tmux',
      args: ['display-message', '-p', '-t', '%1', '#{pane_tty}\t#{pane_width}'],
    });
    expect(fake.commands).toContainEqual(
      expect.objectContaining({
        file: 'sh',
        args: expect.arrayContaining([
          expect.stringContaining('printf'),
          expect.stringContaining('Connected Successfully'),
          expect.stringContaining('Run mobily -h for help. Run mobily exit to exit'),
          expect.stringContaining('\u001b[90m'),
          '/dev/pts/42',
        ]),
      }),
    );
    expect(
      fake.commands.some(
        ({ file, args }) =>
          file === 'tmux' &&
          args[0] === 'send-keys' &&
          args.some((arg) => arg.includes('Connected Successfully')),
      ),
    ).toBe(false);
  });

  it('pins the connected workstation panel at the initial two-line height', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'has-session') return '';
        if (args[0] === 'split-window') return '%9\n';
        if (args[0] === 'list-panes') return '%0 \n%9 qr\n';
        return '';
      }),
    });
    const backend = new TmuxBackend(
      { cwd: '/workspace', sessionName: 'mobily-work-1234' },
      fake.value,
    );

    backend.showPairingPanel(CONNECTED_WORKSTATION_PANEL, CONNECTED_WORKSTATION_PANEL_HEIGHT);

    expect(fake.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'tmux',
          args: expect.arrayContaining([
            'split-window',
            '-l',
            String(CONNECTED_WORKSTATION_PANEL_HEIGHT),
          ]),
        }),
        {
          file: 'tmux',
          args: [
            'set-option',
            '-p',
            '-t',
            '%9',
            '@mobily_panel_lines',
            String(CONNECTED_WORKSTATION_PANEL_HEIGHT),
          ],
        },
        {
          file: 'tmux',
          args: ['resize-pane', '-t', '%9', '-y', String(CONNECTED_WORKSTATION_PANEL_HEIGHT)],
        },
      ]),
    );
    backend.dispose();
  });

  it('hides the connected workstation panel after dismiss', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'has-session') return '';
        if (args[0] === 'split-window') return '%9\n';
        if (args[0] === 'list-panes') return '%0 \n%9 qr\n';
        return '';
      }),
    });
    const backend = new TmuxBackend(
      { cwd: '/workspace', sessionName: 'mobily-work-1234' },
      fake.value,
    );

    backend.showPairingPanel(CONNECTED_WORKSTATION_PANEL, CONNECTED_WORKSTATION_PANEL_HEIGHT);
    fake.commands.length = 0;
    backend.hidePairingPanel();

    expect(fake.commands).toEqual(
      expect.arrayContaining([
        {
          file: 'tmux',
          args: ['list-panes', '-t', 'mobily-work-1234', '-F', '#{pane_id} #{@mobily_role}'],
        },
        { file: 'tmux', args: ['kill-pane', '-t', '%9'] },
      ]),
    );
    backend.dispose();
  });
});

describe('Session backend factory', () => {
  it('signals the owning CLI process for mobily exit', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        return 'MOBILY_CLI_PID=4242\n';
      }),
    });
    const signalProcess = vi.fn();

    expect(exitCurrentMobily(fake.value, signalProcess)).toBe(true);

    expect(fake.commands).toContainEqual({
      file: 'tmux',
      args: ['show-environment', 'MOBILY_CLI_PID'],
    });
    expect(signalProcess).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('uses a stable validated cwd-derived name and selects tmux when available', () => {
    const fake = runtime();
    const first = defaultSessionName('/work/My Project', (path) => path);
    const second = defaultSessionName('/work/My Project', (path) => path);
    expect(first).toBe(second);
    expect(first).toMatch(/^mobily-my-project-[a-f0-9]{8}$/);
    expect(validateSessionName(first)).toBe(first);
    expect(() => validateSessionName('../bad')).toThrow(TypeError);

    const backend = createSessionBackend({ cwd: '/work/My Project' }, fake.value);
    expect(backend.kind).toBe('tmux');
    backend.dispose();
  });

  it('falls back to bare mode when tmux is unavailable', () => {
    const fake = runtime({
      execFile: vi.fn(() => {
        throw new Error('not found');
      }),
    });
    expect(isTmuxAvailable(fake.value)).toBe(false);

    const backend = createSessionBackend({ cwd: '/workspace' }, fake.value);
    expect(backend.kind).toBe('bare');
    backend.dispose();
  });
});

const tmuxAvailable = (() => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!tmuxAvailable)('real tmux integration', () => {
  const names: string[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const name of names.splice(0)) {
      try {
        execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
      } catch {
        // The test may already have removed the session.
      }
    }
    for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('survives Mobily detach and seeds replay when the backend reattaches', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'mobily-tmux-')));
    directories.push(cwd);
    const name = `mobily-test-${process.pid}-${Date.now()}`;
    names.push(name);
    const markerSuffix = `TMUX_${Date.now()}`;
    const marker = `MOBILY_${markerSuffix}`;
    const first = new TmuxBackend({ cwd, sessionName: name });
    const output = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('tmux output timed out')), 10_000);
      first.onData((data) => {
        if (data.includes(marker)) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    first.write(`printf 'MOBILY_%s\\n' '${markerSuffix}'\r`);
    await output;
    first.dispose();

    expect(() => execFileSync('tmux', ['has-session', '-t', name])).not.toThrow();
    const second = new TmuxBackend({ cwd, sessionName: name });
    expect(second.readScrollback(50)).toContain(marker);
    second.dispose();

    killTmuxSession(name);
    names.splice(names.indexOf(name), 1);
    expect(() => execFileSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' })).toThrow();
  }, 20_000);

  it('pins pairing details in a marked tmux pane', () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'mobily-tmux-panel-')));
    directories.push(cwd);
    const name = `mobily-panel-${process.pid}-${Date.now()}`;
    names.push(name);
    const backend = new TmuxBackend({ cwd, sessionName: name });

    backend.showPairingPanel('PAIRING CODE: ABC123', 8);

    const panes = execFileSync(
      'tmux',
      ['list-panes', '-t', name, '-F', '#{pane_id} #{@mobily_role}'],
      { encoding: 'utf8' },
    );
    expect(panes).toContain(' qr');
    backend.dispose();
  });

  it('shows the connected banner until the shell executes clear', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'mobily-tmux-banner-')));
    directories.push(cwd);
    const name = `mobily-banner-${process.pid}-${Date.now()}`;
    names.push(name);
    const backend = new TmuxBackend({ cwd, sessionName: name, cols: 80, rows: 12 });

    expect(clearShellPane(name, defaultSessionRuntime)).toBe(true);
    expect(
      printShellPaneLines(
        name,
        ['Connected Successfully', 'Run mobily -h for help. Run mobily exit to exit'],
        defaultSessionRuntime,
      ),
    ).toBe(true);

    const capture = (): string =>
      execFileSync('tmux', ['capture-pane', '-p', '-t', name], { encoding: 'utf8' });
    await vi.waitFor(() => expect(capture()).toContain('Connected Successfully'));
    expect(capture()).toContain('────────────────');

    execFileSync('tmux', ['send-keys', '-t', name, '-l', 'clear']);
    execFileSync('tmux', ['send-keys', '-t', name, 'Enter']);
    await vi.waitFor(() => expect(capture()).not.toContain('Connected Successfully'));

    backend.dispose();
  });
});
