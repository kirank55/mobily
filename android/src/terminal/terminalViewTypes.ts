import type { SessionSnapshotFrame } from '@mobily/shared';

export interface TerminalViewHandle {
  /** Write raw PTY data (ANSI/UTF-8) to the terminal. */
  write(data: string, latencyTags?: readonly string[]): void;
  /** Atomically replace the visible terminal with a Session Snapshot. */
  applySnapshot(snapshot: SessionSnapshotFrame): void;
  /** Load bounded history behind the current screen without disturbing live output. */
  applyScrollback(data: string, snapshot: SessionSnapshotFrame, liveOutput: string): void;
  /** Request the terminal to resize to the given dimensions. */
  resize(cols: number, rows: number): void;
  /** Show connection status without clearing the rendered terminal frame. */
  setConnectionState(state: 'loading' | 'reconnecting' | 'live', detail?: string): void;
  /** Tell the document whether Android currently owns Session dimensions. */
  setSizeOwnership(owned: boolean): void;
  /** Apply a persisted or explicit readable font size (reflows the grid when owning). */
  setFontSize(fontSize: number): void;
  /** Nudge the readable font size up or down. */
  adjustFontSize(delta: number): void;
  fit(): void;
  /** Repaint every terminal row without changing the Session buffer. */
  refresh(): void;
  zoomIn(): void;
  zoomOut(): void;
  setSelectionMode(enabled: boolean): void;
  copySelection(): void;
  paste(data: string): void;
  showKeyboard(): void;
  hideKeyboard(): void;
  /** Query current P50/P95 latency stats (result arrives via onLatencyStats). */
  getLatencyStats(): void;
}

export interface TerminalViewProps {
  /** Called when the WebView terminal signals it is ready. */
  onReady?: () => void;
  /** Called after xterm has parsed the first Session Snapshot. */
  onSnapshotApplied?: () => void;
  /** Called when the user types or pastes in the terminal. */
  onInput?: (data: string, latencyTag: string) => void;
  /** Called when the owning terminal proposes dimensions from the usable viewport. */
  onResize?: (cols: number, rows: number) => void;
  /** Called when the document changes the readable font size. */
  onFontSize?: (fontSize: number) => void;
  onCopy?: (data: string) => void;
  /** Called with latency stats (P50/P95 in ms). */
  onLatencyStats?: (n: number, p50: number, p95: number) => void;
}
