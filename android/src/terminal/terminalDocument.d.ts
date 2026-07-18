export interface TerminalDocumentAssets {
  readonly xtermCss: string;
  readonly xtermJs: string;
  readonly xtermFitJs: string;
  readonly devBridgeJs?: string;
}

export function buildTerminalDocument(assets: TerminalDocumentAssets): string;

export function clampTerminalScale(value: number): number;
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
import type { SessionSnapshotFrame } from '@mobily/shared';
