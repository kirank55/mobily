import type { IDisposable, PtyProcess, SpawnOptions } from '../pty.js';
import { ScrollbackBuffer } from './scrollback.js';
import { PtyOutputHub } from './outputHub.js';
import { defaultSessionRuntime, type SessionRuntime } from './runtime.js';
import type { SessionBackend } from './types.js';

export interface BareBackendOptions extends SpawnOptions {
  scrollbackBytes?: number;
}

/**
 * Bare PTY Shell Backend. Visible Capture Mode reconstructs the current screen
 * by replaying the bounded raw transcript retained for this CLI run (ADR-0004).
 * That reconstruction is distinct from {@link readScrollback}'s trailing-line window.
 */
export class BareBackend implements SessionBackend {
  readonly kind = 'bare' as const;
  readonly sessionName = null;
  readonly attachCommand = null;

  private readonly pty: PtyProcess;
  private readonly hub: PtyOutputHub;
  private readonly dataSubscription: IDisposable;
  private disposed = false;

  constructor(options: BareBackendOptions = {}, runtime: SessionRuntime = defaultSessionRuntime) {
    const { scrollbackBytes, ...spawnOptions } = options;
    this.hub = new PtyOutputHub(new ScrollbackBuffer(scrollbackBytes));
    this.pty = runtime.spawnPty(spawnOptions);
    this.dataSubscription = this.pty.onData((data) => this.hub.push(data));
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  onData(listener: (data: string) => void): IDisposable {
    return this.hub.onData(listener);
  }

  onExit(listener: Parameters<PtyProcess['onExit']>[0]): IDisposable {
    return this.pty.onExit(listener);
  }

  /**
   * One ANSI reconstruction of the current visible screen: the full bounded
   * transcript for this run (not the trailing-line scrollback window).
   */
  captureVisibleScreen(): string {
    return this.hub.scrollback.readAll();
  }

  readScrollback(maxLines?: number): string {
    return this.hub.scrollback.read(maxLines);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dataSubscription.dispose();
    this.hub.clear();
    this.pty.kill();
  }
}
