import type { IDisposable, PtyProcess, SpawnOptions } from '../pty/node-pty.js';
import { ScrollbackBuffer } from './scrollback.js';
import { defaultSessionRuntime, type SessionRuntime } from './runtime.js';
import type { SessionBackend } from './types.js';

export interface BareBackendOptions extends SpawnOptions {
  scrollbackBytes?: number;
}

export class BareBackend implements SessionBackend {
  readonly kind = 'bare' as const;
  readonly sessionName = null;
  readonly attachCommand = null;

  private readonly pty: PtyProcess;
  private readonly scrollback: ScrollbackBuffer;
  private readonly listeners = new Set<(data: string) => void>();
  private readonly dataSubscription: IDisposable;
  private disposed = false;

  constructor(options: BareBackendOptions = {}, runtime: SessionRuntime = defaultSessionRuntime) {
    const { scrollbackBytes, ...spawnOptions } = options;
    this.scrollback = new ScrollbackBuffer(scrollbackBytes);
    this.pty = runtime.spawnPty(spawnOptions);
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
