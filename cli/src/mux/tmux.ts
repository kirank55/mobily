import type { IDisposable, PtyProcess, SpawnOptions } from '../pty/node-pty.js';
import { ScrollbackBuffer } from './scrollback.js';
import { defaultSessionRuntime, type SessionRuntime } from './runtime.js';
import type { SessionBackend } from './types.js';

const INITIAL_CAPTURE_LINES = 500;

export interface TmuxBackendOptions extends SpawnOptions {
  cwd: string;
  sessionName: string;
  scrollbackBytes?: number;
}

export class TmuxBackend implements SessionBackend {
  readonly kind = 'tmux' as const;
  readonly sessionName: string;
  readonly attachCommand: string;

  private readonly pty: PtyProcess;
  private readonly scrollback: ScrollbackBuffer;
  private readonly listeners = new Set<(data: string) => void>();
  private readonly dataSubscription: IDisposable;
  private disposed = false;

  constructor(options: TmuxBackendOptions, runtime: SessionRuntime = defaultSessionRuntime) {
    const { cwd, sessionName, scrollbackBytes, cols, rows, env, terminalName } = options;
    this.sessionName = sessionName;
    this.attachCommand = `tmux attach-session -t ${sessionName}`;
    this.scrollback = new ScrollbackBuffer(scrollbackBytes);

    if (!sessionExists(sessionName, runtime)) {
      runtime.execFile('tmux', ['new-session', '-d', '-s', sessionName, '-c', cwd]);
    }
    runtime.execFile('tmux', [
      'set-window-option',
      '-t',
      sessionName,
      'window-size',
      'largest',
    ]);
    try {
      this.scrollback.append(
        runtime.execFile('tmux', [
          'capture-pane',
          '-p',
          '-J',
          '-S',
          `-${INITIAL_CAPTURE_LINES}`,
          '-t',
          sessionName,
        ]),
      );
    } catch {
      // A newly-created empty pane may not have capture content yet.
    }

    this.pty = runtime.spawnPty({
      file: 'tmux',
      args: ['attach-session', '-t', sessionName],
      cwd,
      cols,
      rows,
      env,
      terminalName,
    });
    this.dataSubscription = this.pty.onData((data) => {
      this.scrollback.append(data);
      for (const listener of this.listeners) listener(data);
    });
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  onData(listener: (data: string) => void): IDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  onExit(listener: Parameters<PtyProcess['onExit']>[0]): IDisposable {
    return this.pty.onExit(listener);
  }

  readScrollback(maxLines?: number): string {
    return this.scrollback.read(maxLines);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dataSubscription.dispose();
    this.listeners.clear();
    this.pty.kill();
  }
}

function sessionExists(name: string, runtime: SessionRuntime): boolean {
  try {
    runtime.execFile('tmux', ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}
