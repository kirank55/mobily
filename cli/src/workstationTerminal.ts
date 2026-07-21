import type { Session } from './session.js';
import type { SessionBackend } from './mux/types.js';
import type { IDisposable } from './pty/node-pty.js';

const CTRL_X = '\u0018';
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_DIMENSION = 1000;
const DISABLE_MOUSE =
  '\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1005l\u001b[?1006l\u001b[?1015l';
const TERMINAL_RESET = `${DISABLE_MOUSE}\u001b[0m\u001b[?25h\r\n`;
const MOUSE_MODES = new Set(['1000', '1002', '1003', '1005', '1006', '1015']);
const INCOMPLETE_MOUSE_OUTPUT = new RegExp(String.raw`\u001b(?:\[|\[\?[0-9;]*)$`);
const MOUSE_MODE_CONTROL = new RegExp(String.raw`\u001b\[\?([0-9;]+)([hl])`, 'g');
const INCOMPLETE_MOUSE_INPUT = new RegExp(String.raw`\u001b(?:\[<[^mM]*|\[M.{0,2})$`, 's');
const SGR_MOUSE_REPORT = new RegExp(String.raw`\u001b\[<\d+;\d+;\d+[mM]`, 'g');
const URXVT_MOUSE_REPORT = new RegExp(String.raw`\u001b\[\d+;\d+;\d+M`, 'g');
const X10_MOUSE_REPORT = new RegExp(String.raw`\u001b\[M[\s\S]{3}`, 'g');

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

  const outputFilter = new MouseOutputFilter();
  const inputFilter = new MouseInputFilter();
  safely(() => output.write(DISABLE_MOUSE));
  const attachment = session.attachLocalTerminal({
    onOutput: (data) => {
      const safeData = outputFilter.push(data);
      if (safeData.length > 0) output.write(safeData);
    },
    onExit: () => requestShutdown('session-exited'),
    onError: () => requestShutdown('output-failed'),
  });

  const resize = (): void => {
    const { cols, rows } = workstationTerminalSize(output);
    attachment.resize(cols, rows);
  };
  const onData = (data: string): void => {
    const shutdownIndex = data.indexOf(CTRL_X);
    const sessionInput = inputFilter.push(
      shutdownIndex === -1 ? data : data.slice(0, shutdownIndex),
    );
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

/** Removes DEC mouse tracking controls while preserving every other byte. */
class MouseOutputFilter {
  private pending = '';

  push(data: string): string {
    const value = this.pending + data;
    this.pending = '';
    const incomplete = value.match(INCOMPLETE_MOUSE_OUTPUT);
    const complete = incomplete ? value.slice(0, -incomplete[0].length) : value;
    if (incomplete) this.pending = incomplete[0];
    return complete.replace(
      MOUSE_MODE_CONTROL,
      (_sequence, parameters: string, command: string) => {
        const remaining = parameters.split(';').filter((parameter) => !MOUSE_MODES.has(parameter));
        return remaining.length > 0 ? `\u001b[?${remaining.join(';')}${command}` : '';
      },
    );
  }
}

/** Defensive input filter for mouse reports emitted by a previously-enabled emulator. */
class MouseInputFilter {
  private pending = '';

  push(data: string): string {
    const value = this.pending + data;
    this.pending = '';
    const incomplete = value.match(INCOMPLETE_MOUSE_INPUT);
    const complete = incomplete ? value.slice(0, -incomplete[0].length) : value;
    if (incomplete) this.pending = incomplete[0];
    return complete
      .replace(SGR_MOUSE_REPORT, '')
      .replace(URXVT_MOUSE_REPORT, '')
      .replace(X10_MOUSE_REPORT, '');
  }
}
