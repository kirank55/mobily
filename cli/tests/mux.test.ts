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
  isTmuxAvailable,
  killTmuxSession,
  validateSessionName,
  type SessionRuntime,
} from '../src/mux/factory.js';
import { TmuxBackend } from '../src/mux/tmux.js';

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
    const backend = new BareBackend(
      { cwd: '/workspace', scrollbackBytes: 32 },
      fake.value,
    );
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
});

describe('TmuxBackend', () => {
  it('creates, configures, captures, and attaches a named session without a shell', () => {
    const fake = runtime({
      execFile: vi.fn((file: string, args: string[]) => {
        fake.commands.push({ file, args });
        if (args[0] === 'has-session') throw new Error('missing');
        if (args[0] === 'capture-pane') return 'captured\n';
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
          args: ['capture-pane', '-p', '-J', '-S', '-500', '-t', 'mobily-work-1234'],
        },
      ]),
    );
    expect(fake.value.spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({
        file: 'tmux',
        args: ['attach-session', '-t', 'mobily-work-1234'],
      }),
    );
    expect(backend.readScrollback()).toContain('captured');
    expect(backend.attachCommand).toBe('tmux attach-session -t mobily-work-1234');

    backend.dispose();
    expect(fake.pty.killed).toBe(true);
    expect(fake.commands.some(({ args }) => args[0] === 'kill-session')).toBe(false);
  });
});

describe('Session backend factory', () => {
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
    expect(() =>
      execFileSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' }),
    ).toThrow();
  }, 20_000);
});
