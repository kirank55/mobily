import type { Session } from '../session.js';
import type { SessionBackend } from '../sessionBackend/types.js';
import type { IDisposable } from '../pty.js';
import { CONNECTED_WORKSTATION_INTRO } from './connectedBanner.js';

const CTRL_X = '\u0018';
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_DIMENSION = 1000;
const TERMINAL_RESET = '\u001b[0m\u001b[?25h\r\n';

export interface WorkstationInput {
  readonly isTTY?: boolean;
  setRawMode?(enabled: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', listener: (data: string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  off(event: 'data', listener: (data: string) => void): unknown;
  off(event: 'end', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
}

export interface WorkstationOutput {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  write(data: string): unknown;
  on(event: 'resize', listener: () => void): unknown;
  off(event: 'resize', listener: () => void): unknown;
}

export interface WorkstationTerminalOptions {
  input?: WorkstationInput;
  output?: WorkstationOutput;
  onShutdown(reason: WorkstationShutdownCause): void;
}

export type WorkstationShutdownCause =
  'ctrl-x' | 'input-closed' | 'session-exited' | 'output-failed';

export function shouldEmbedWorkstationTerminal(
  backend: Pick<SessionBackend, 'kind'>,
  input: Pick<WorkstationInput, 'isTTY' | 'setRawMode'> = process.stdin,
  output: Pick<WorkstationOutput, 'isTTY'> = process.stdout,
): boolean {
  return Boolean(
    backend.kind === 'bare' &&
    input.isTTY &&
    output.isTTY &&
    typeof input.setRawMode === 'function',
  );
}

export function workstationTerminalSize(
  output: Pick<WorkstationOutput, 'columns' | 'rows'> = process.stdout,
): { cols: number; rows: number } {
  return {
    cols: terminalDimension(output.columns, DEFAULT_COLS),
    rows: terminalDimension(output.rows, DEFAULT_ROWS),
  };
}

export function attachWorkstationTerminal(
  session: Session,
  options: WorkstationTerminalOptions,
): IDisposable | null {
  const input: WorkstationInput = options.input ?? process.stdin;
  const output: WorkstationOutput = options.output ?? process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return null;

  let disposed = false;
  let shutdownRequested = false;
  const requestShutdown = (reason: WorkstationShutdownCause): void => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    options.onShutdown(reason);
  };

  // Replace the pairing screen with the Connected banner before the Session
  // mirror starts, matching the tmux attach path on every OS (the pairing
  // text otherwise lingers above the shell on Windows consoles).
  safely(() => output.write(CONNECTED_WORKSTATION_INTRO));
  const attachment = session.attachLocalTerminal({
    onOutput: (data) => output.write(data),
    onExit: () => requestShutdown('session-exited'),
    onError: () => requestShutdown('output-failed'),
  });

  const resize = (): void => {
    const { cols, rows } = workstationTerminalSize(output);
    attachment.resize(cols, rows);
  };
  const onData = (data: string): void => {
    const shutdownIndex = data.indexOf(CTRL_X);
    const sessionInput = shutdownIndex === -1 ? data : data.slice(0, shutdownIndex);
    if (sessionInput.length > 0) attachment.input(sessionInput);
    if (shutdownIndex !== -1) requestShutdown('ctrl-x');
  };
  const onInputClosed = (): void => requestShutdown('input-closed');

  let rawModeEnabled = false;
  let inputResumed = false;
  let dataListenerAttached = false;
  let endListenerAttached = false;
  let closeListenerAttached = false;
  let resizeListenerAttached = false;

  const cleanup = (): void => {
    if (dataListenerAttached) safely(() => input.off('data', onData));
    if (endListenerAttached) safely(() => input.off('end', onInputClosed));
    if (closeListenerAttached) safely(() => input.off('close', onInputClosed));
    if (resizeListenerAttached) safely(() => output.off('resize', resize));
    safely(() => attachment.dispose());
    if (rawModeEnabled) safely(() => input.setRawMode?.(false));
    if (inputResumed) safely(() => input.pause());
    safely(() => output.write(TERMINAL_RESET));
  };

  try {
    input.setEncoding('utf8');
    input.setRawMode(true);
    rawModeEnabled = true;
    input.resume();
    inputResumed = true;
    input.on('data', onData);
    dataListenerAttached = true;
    input.on('end', onInputClosed);
    endListenerAttached = true;
    input.on('close', onInputClosed);
    closeListenerAttached = true;
    output.on('resize', resize);
    resizeListenerAttached = true;
    resize();
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cleanup();
    },
  };
}

function safely(action: () => unknown): void {
  try {
    action();
  } catch {
    // Terminal cleanup is best-effort so later cleanup steps always run.
  }
}

function terminalDimension(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) return fallback;
  return Math.min(value, MAX_DIMENSION);
}
