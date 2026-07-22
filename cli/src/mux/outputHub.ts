import type { IDisposable } from '../pty/node-pty.js';
import { ScrollbackBuffer } from './scrollback.js';

/**
 * Shared PTY output fan-out: append to scrollback and notify live listeners.
 * Both Shell Backend adapters use this so capture/scrollback semantics stay local
 * to each adapter while the fan-out path is not duplicated.
 */
export class PtyOutputHub {
  private readonly listeners = new Set<(data: string) => void>();

  constructor(readonly scrollback: ScrollbackBuffer) {}

  onData(listener: (data: string) => void): IDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  push(data: string): void {
    this.scrollback.append(data);
    for (const listener of this.listeners) listener(data);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Build one attributed ANSI reconstruction of a visible pane (tmux `capture-pane -e`
 * plus cursor metadata). Callers parse this into the Canonical Terminal Screen;
 * it is never a scrollback/history API.
 */
export function reconstructAttributedVisibleAnsi(options: {
  contents: string;
  alternateOn: boolean;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  cursorShape?: string;
  cursorBlinking?: boolean;
}): string {
  const lines = options.contents.replace(/\r?\n$/, '').split(/\r?\n/);
  const screen = lines.map((line, row) => `\u001b[${row + 1};1H${line}`).join('');
  const activeScreen = options.alternateOn ? '\u001b[?1049h' : '\u001b[?1049l';
  const cursor = `\u001b[${options.cursorY + 1};${options.cursorX + 1}H`;
  const visibility = options.cursorVisible ? '\u001b[?25h' : '\u001b[?25l';
  const style = visibleCursorStyleControl(options.cursorShape, options.cursorBlinking);
  return `${activeScreen}\u001b[2J\u001b[H${screen}\u001b[0m${style}${cursor}${visibility}`;
}

/** DECSCUSR from tmux cursor_shape / cursor_blinking (block+blink when unknown). */
export function visibleCursorStyleControl(
  shape: string | undefined,
  blinking: boolean | string | undefined,
): string {
  const steady = blinking === false || blinking === '0';
  const code =
    shape === 'underline' ? (steady ? 4 : 3) : shape === 'bar' ? (steady ? 6 : 5) : steady ? 2 : 1;
  return `\u001b[${code} q`;
}
