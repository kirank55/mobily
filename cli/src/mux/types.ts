import type { ExitEvent, IDisposable } from '../pty/node-pty.js';

export type SessionBackendKind = 'bare' | 'tmux';

/** Terminal behavior consumed by Session, independent of its process adapter. */
export interface SessionBackend {
  readonly kind: SessionBackendKind;
  readonly sessionName: string | null;
  readonly attachCommand: string | null;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): IDisposable;
  onExit(listener: (event: ExitEvent) => void): IDisposable;
  /**
   * Return one ANSI reconstruction of the backend's current visible screen.
   * This is distinct from scrollback or other replay history.
   */
  captureVisibleScreen(): string;
  readScrollback(maxLines?: number): string;
  /** Pin pairing details above the shell for the next workstation attachment. */
  showPairingPanel?(content: string, height: number): void;
  dispose(): void;
}
