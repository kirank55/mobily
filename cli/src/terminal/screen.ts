import xtermHeadless from '@xterm/headless';
import type { IBufferCell, Terminal } from '@xterm/headless';
import {
  TERMINAL_CELL_ATTRIBUTES,
  type SessionSnapshotFrame,
  type TerminalColor,
  type TerminalSnapshotCell,
} from '@mobily/shared';

const { Terminal: HeadlessTerminal } = xtermHeadless;
/**
 * Backend-neutral canonical visible terminal state.
 *
 * All mutations and captures share one parser queue. A capture enqueued between
 * two writes therefore observes the first write and precedes the second.
 */
export class CanonicalTerminalScreen {
  private readonly terminal: Terminal;
  private queue = Promise.resolve();
  private cursorVisible = true;
  private cursorStyle: 'block' | 'underline' | 'bar' = 'block';
  private cursorBlink = true;
  private disposed = false;

  constructor(cols: number, rows: number) {
    this.terminal = new HeadlessTerminal({
      allowProposedApi: true,
      cols,
      rows,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 500,
      convertEol: false,
    });
    this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (params.includes(25)) this.cursorVisible = true;
      return false;
    });
    this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (params.includes(25)) this.cursorVisible = false;
      return false;
    });
    this.terminal.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
      this.applyCursorStyle(typeof params[0] === 'number' ? params[0] : 0);
      return false;
    });
  }

  write(data: string, afterParsed: () => void = () => undefined): void {
    this.enqueue(
      () =>
        new Promise<void>((resolve) => {
          if (this.disposed) {
            resolve();
            return;
          }
          this.terminal.write(data, () => {
            try {
              afterParsed();
            } finally {
              resolve();
            }
          });
        }),
    );
  }

  resize(cols: number, rows: number, afterResize: () => void = () => undefined): void {
    this.enqueue(() => {
      if (!this.disposed) this.terminal.resize(cols, rows);
      afterResize();
    });
  }

  capture(consumer: (snapshot: SessionSnapshotFrame) => void): void {
    this.enqueue(() => {
      if (!this.disposed) consumer(this.snapshot());
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminal.dispose();
  }

  private enqueue(task: () => void | Promise<void>): void {
    this.queue = this.queue.then(task, task).then(
      () => undefined,
      () => undefined,
    );
  }

  private snapshot(): SessionSnapshotFrame {
    const buffer = this.terminal.buffer.active;
    const reusableCell = buffer.getNullCell();
    const grid: TerminalSnapshotCell[][] = [];
    for (let row = 0; row < this.terminal.rows; row++) {
      const line = buffer.getLine(buffer.viewportY + row);
      const cells: TerminalSnapshotCell[] = [];
      for (let col = 0; col < this.terminal.cols; col++) {
        const cell = line?.getCell(col, reusableCell);
        cells.push(cell ? snapshotCell(cell) : { chars: '', width: 1 });
      }
      grid.push(cells);
    }
    return {
      type: 'session-snapshot',
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      activeScreen: buffer.type,
      cursor: {
        col: buffer.cursorX,
        row: buffer.cursorY,
        visible: this.cursorVisible,
        style: this.cursorStyle,
        blink: this.cursorBlink,
      },
      grid,
    };
  }

  private applyCursorStyle(value: number): void {
    switch (value) {
      case 2:
        this.cursorStyle = 'block';
        this.cursorBlink = false;
        break;
      case 3:
        this.cursorStyle = 'underline';
        this.cursorBlink = true;
        break;
      case 4:
        this.cursorStyle = 'underline';
        this.cursorBlink = false;
        break;
      case 5:
        this.cursorStyle = 'bar';
        this.cursorBlink = true;
        break;
      case 6:
        this.cursorStyle = 'bar';
        this.cursorBlink = false;
        break;
      default:
        this.cursorStyle = 'block';
        this.cursorBlink = true;
    }
  }
}

function snapshotCell(cell: IBufferCell): TerminalSnapshotCell {
  const attrs =
    (cell.isBold() ? TERMINAL_CELL_ATTRIBUTES.BOLD : 0) |
    (cell.isDim() ? TERMINAL_CELL_ATTRIBUTES.DIM : 0) |
    (cell.isItalic() ? TERMINAL_CELL_ATTRIBUTES.ITALIC : 0) |
    (cell.isUnderline() ? TERMINAL_CELL_ATTRIBUTES.UNDERLINE : 0) |
    (cell.isBlink() ? TERMINAL_CELL_ATTRIBUTES.BLINK : 0) |
    (cell.isInverse() ? TERMINAL_CELL_ATTRIBUTES.INVERSE : 0) |
    (cell.isInvisible() ? TERMINAL_CELL_ATTRIBUTES.INVISIBLE : 0) |
    (cell.isStrikethrough() ? TERMINAL_CELL_ATTRIBUTES.STRIKETHROUGH : 0) |
    (cell.isOverline() ? TERMINAL_CELL_ATTRIBUTES.OVERLINE : 0);
  const fg = cell.isFgRGB()
    ? ({ mode: 'rgb', value: cell.getFgColor() } satisfies TerminalColor)
    : cell.isFgPalette()
      ? ({ mode: 'palette', value: cell.getFgColor() } satisfies TerminalColor)
      : undefined;
  const bg = cell.isBgRGB()
    ? ({ mode: 'rgb', value: cell.getBgColor() } satisfies TerminalColor)
    : cell.isBgPalette()
      ? ({ mode: 'palette', value: cell.getBgColor() } satisfies TerminalColor)
      : undefined;
  return {
    chars: cell.getChars(),
    width: normalizeCellWidth(cell.getWidth()),
    ...(fg ? { fg } : {}),
    ...(bg ? { bg } : {}),
    ...(attrs ? { attrs } : {}),
  };
}

function normalizeCellWidth(width: number): 0 | 1 | 2 {
  return width === 0 || width === 2 ? width : 1;
}
