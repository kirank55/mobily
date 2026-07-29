import type { SessionSnapshotFrame } from '@mobily/shared';

export interface TerminalDocumentAssets {
  readonly xtermCss: string;
  readonly xtermJs: string;
  readonly xtermFitJs: string;
  readonly devBridgeJs?: string;
  readonly terminalHelpersJs?: string;
}

export function buildTerminalHelpersSource(): string;
export function buildTerminalDocument(assets: TerminalDocumentAssets): string;

export const DEFAULT_READABLE_FONT_SIZE: 14;
export const MIN_READABLE_FONT_SIZE: 10;
export const MAX_READABLE_FONT_SIZE: 28;

export function clampTerminalScale(value: number): number;
export function clampTerminalFontSize(fontSize: number): number;
export function estimateTerminalCellSize(fontSize: number): {
  readonly width: number;
  readonly height: number;
};
export function usableTerminalViewport(layout: {
  readonly width: number;
  readonly height: number;
  readonly horizontalInset?: number;
  readonly topInset?: number;
  readonly bottomInset?: number;
  readonly keyboardHeight?: number;
  readonly controlsHeight?: number;
  readonly extraKeyRowHeight?: number;
}): { readonly width: number; readonly height: number };
export function deriveReadableTerminalGrid(
  viewportWidth: number,
  viewportHeight: number,
  cellWidth: number,
  cellHeight: number,
): { readonly cols: number; readonly rows: number };
export function createDebouncedGridProposer(
  emit: (cols: number, rows: number) => void,
  debounceMs?: number,
): {
  propose(cols: number, rows: number): void;
  acknowledge(cols: number, rows: number): void;
  reset(): void;
};
export function fitTerminalScale(
  viewportWidth: number,
  viewportHeight: number,
  terminalWidth: number,
  terminalHeight: number,
): number;
export function pinchTerminalScale(
  initialScale: number,
  initialDistance: number,
  currentDistance: number,
): number;
export function stripTerminalMouseControls(data: string): string;
export interface TerminalMouseModeState {
  modes: Record<string, number>;
}
export function createTerminalMouseModeState(): TerminalMouseModeState;
export function applyTerminalMouseControls(state: TerminalMouseModeState, data: string): string;
export function isTerminalMouseReportingActive(
  state: TerminalMouseModeState | null | undefined,
): boolean;
export function restoreTerminalMouseControls(data: string): string;
export function sgrMouseClickSequence(col: number, row: number): string;
export function sgrMouseWheelSequence(direction: 'up' | 'down', col: number, row: number): string;
export function hardenTerminalTextarea(term: {
  textarea?: { setAttribute(name: string, value: string): void } | null;
  element?: { querySelector(selectors: string): { setAttribute(name: string, value: string): void } | null } | null;
} | null): void;
export function focusTerminalInput(term: {
  focus?(): void;
  textarea?: { focus(): void } | null;
  element?: { querySelector(selectors: string): { focus(): void } | null } | null;
} | null): void;
export function snapshotToAnsi(snapshot: SessionSnapshotFrame): string | null;
export function scrollbackAndSnapshotToAnsi(
  scrollback: string,
  snapshot: SessionSnapshotFrame,
  liveOutput?: string,
): string | null;

export interface TerminalCell {
  readonly col: number;
  readonly row: number;
}

export function terminalSelectionRange(
  start: TerminalCell,
  end: TerminalCell,
  cols: number,
): { readonly column: number; readonly row: number; readonly length: number };
