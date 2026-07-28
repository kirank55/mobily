import type { ExitEvent, IDisposable } from '../pty.js';

export const MOBILY_CLI_PID_ENV = 'MOBILY_CLI_PID';

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
   * Both adapters produce parseable attributed ANSI for the Canonical Terminal
   * Screen. This is never a substitute for {@link readScrollback}.
   */
  captureVisibleScreen(): string;
  /** Bounded trailing-line history for workstation replay / post-snapshot transfer. */
  readScrollback(maxLines?: number): string;
  /** Pin pairing details above the shell for the next workstation attachment. */
  showPairingPanel?(content: string, height: number): void;
  /** Remove the pairing/status header pane if present. */
  hidePairingPanel?(): void;
  dispose(): void;
}
