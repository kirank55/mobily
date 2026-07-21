import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/headless';
import { MAX_SESSION_SCROLLBACK_CHARS, type SessionSnapshotFrame } from '@mobily/shared';

import {
  buildTerminalDocument,
  clampTerminalScale,
  fitTerminalScale,
  pinchTerminalScale,
  stripTerminalMouseControls,
  snapshotToAnsi,
  scrollbackAndSnapshotToAnsi,
  terminalSelectionRange,
} from '../src/terminal/terminalDocument';
import { TERMINAL_HELPERS_JS } from '../src/terminal/xtermAssets.generated';

describe('terminal document', () => {
  it('uses the same generator for production and the browser harness', () => {
    const production = buildTerminalDocument({
      xtermCss: 'css-marker',
      xtermJs: 'xterm-marker',
      xtermFitJs: 'fit-marker',
    });
    expect(production).toContain('css-marker');
    expect(production).toContain('xterm-marker');
    expect(production).toContain('fit-marker');
    expect(production).toContain("msg.type==='zoom'");
    expect(production).toContain("msg.type==='font-delta'");
    expect(production).toContain("msg.type==='size-ownership'");
    expect(production).toContain("msg.type==='selection-mode'");
    expect(production).toContain('stripMouseModes');
    expect(production).toContain('touchmove');
    expect(production).toContain("msg.type==='paste'");
    expect(production).toContain('proposeOwnerGrid');
    expect(production).toContain("sendRN({type:'resize'");
    expect(production).toContain("msg.type==='fit')fitView()");
    expect(readFileSync(resolve(__dirname, '../dev/term.html'), 'utf8')).toContain(
      '[mobily harness] terminal ready',
    );
  });

  it('re-announces readiness when React Native probes after page load', () => {
    const production = buildTerminalDocument({
      xtermCss: '',
      xtermJs: '',
      xtermFitJs: '',
    });

    expect(production).toContain("msg.type==='ready-probe'&&term)sendRN({type:'ready'});");
  });

  it('does not serialize Hermes bytecode placeholders into the document', () => {
    const originalToString = Function.prototype.toString;
    try {
      Function.prototype.toString = function hermesFunctionToString() {
        return `function ${this.name}() { [bytecode] }`;
      };

      const production = buildTerminalDocument({
        xtermCss: '',
        xtermJs: '',
        xtermFitJs: '',
        terminalHelpersJs: TERMINAL_HELPERS_JS,
      });

      expect(production).not.toContain('[bytecode]');
    } finally {
      Function.prototype.toString = originalToString;
    }
  });

  it('fits and zooms a stable grid without changing terminal dimensions', () => {
    expect(fitTerminalScale(360, 720, 1200, 640)).toBe(0.3);
    expect(clampTerminalScale(0.05)).toBe(0.2);
    expect(clampTerminalScale(4)).toBe(3);
    expect(clampTerminalScale(1.25)).toBe(1.25);
    expect(pinchTerminalScale(0.5, 100, 200)).toBe(1);
    expect(pinchTerminalScale(2, 100, 400)).toBe(3);
  });

  it('preserves generic ANSI output while suppressing terminal mouse ownership', () => {
    const fixture = '\u001b[2J\u001b[31mwide TUI\u001b[0m\u001b[?1002;1049h';
    expect(stripTerminalMouseControls(fixture)).toBe(
      '\u001b[2J\u001b[31mwide TUI\u001b[0m\u001b[?1049h',
    );
  });

  it('reconstructs a styled nonblank first frame in the production terminal parser', async () => {
    const ansi = snapshotToAnsi({
      type: 'session-snapshot',
      cols: 4,
      rows: 2,
      activeScreen: 'alternate',
      cursor: { col: 2, row: 1, visible: false, style: 'bar', blink: false },
      grid: [
        [
          {
            chars: '界',
            width: 2,
            fg: { mode: 'rgb', value: 0x12abef },
            attrs: 1,
          },
          { chars: '', width: 0 },
          { chars: 'O', width: 1 },
          { chars: 'K', width: 1 },
        ],
        [
          { chars: '>', width: 1 },
          { chars: ' ', width: 1 },
          { chars: ' ', width: 1 },
          { chars: ' ', width: 1 },
        ],
      ],
    });
    expect(ansi).not.toBeNull();

    const terminal = new Terminal({ allowProposedApi: true, cols: 4, rows: 2 });
    await new Promise<void>((resolve) => terminal.write(ansi!, resolve));
    expect(terminal.buffer.active.type).toBe('alternate');
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('界OK');
    expect(terminal.buffer.active.getLine(0)?.getCell(0)?.isBold()).toBeTruthy();
    expect(terminal.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(0x12abef);
    expect(terminal.buffer.active.cursorX).toBe(2);
    expect(terminal.buffer.active.cursorY).toBe(1);
    terminal.dispose();
  });

  it('loads maximum scrollback behind the already-painted current screen', async () => {
    const current: SessionSnapshotFrame = {
      type: 'session-snapshot',
      cols: 8,
      rows: 2,
      activeScreen: 'normal',
      cursor: { col: 7, row: 1, visible: true, style: 'block', blink: false },
      grid: [
        Array.from('CURRENT ', (chars) => ({ chars, width: 1 as const })),
        Array.from('SCREEN  ', (chars) => ({ chars, width: 1 as const })),
      ],
    };
    const history = `${'history line\r\n'.repeat(50_000)}FINAL HISTORY\r\n`.slice(
      -MAX_SESSION_SCROLLBACK_CHARS,
    );
    expect(history).toHaveLength(MAX_SESSION_SCROLLBACK_CHARS);
    const ansi = scrollbackAndSnapshotToAnsi(history, current, '\r\nLIVE AFTER PAINT');
    expect(ansi).not.toBeNull();

    const terminal = new Terminal({ allowProposedApi: true, cols: 8, rows: 2, scrollback: 5_000 });
    await new Promise<void>((resolve) => terminal.write(ansi!, resolve));
    expect(terminal.buffer.active.baseY).toBeGreaterThan(0);
    expect(
      Array.from({ length: terminal.rows }, (_, row) =>
        terminal.buffer.active
          .getLine(terminal.buffer.active.viewportY + row)
          ?.translateToString(true),
      ).join(''),
    ).toContain('LIVE AFTER PAINT');
    terminal.dispose();
  });

  it('normalizes forward and reverse touch selections across terminal rows', () => {
    expect(terminalSelectionRange({ col: 4, row: 2 }, { col: 8, row: 3 }, 120)).toEqual({
      column: 4,
      row: 2,
      length: 125,
    });
    expect(terminalSelectionRange({ col: 8, row: 3 }, { col: 4, row: 2 }, 120)).toEqual({
      column: 4,
      row: 2,
      length: 125,
    });
  });
});
