import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/headless';
import { MAX_SESSION_SCROLLBACK_CHARS, type SessionSnapshotFrame } from '@mobily/shared';

import {
  applyTerminalMouseControls,
  buildTerminalDocument,
  clampTerminalScale,
  createTerminalMouseModeState,
  fitTerminalScale,
  focusTerminalInput,
  isTerminalMouseReportingActive,
  pinchTerminalScale,
  restoreTerminalMouseControls,
  sgrMouseClickSequence,
  sgrMouseWheelSequence,
  stripTerminalMouseControls,
  snapshotToAnsi,
  scrollbackAndSnapshotToAnsi,
  terminalSelectionRange,
} from '../src/terminal/terminalDocument';
import { TERMINAL_HELPERS_JS } from '../src/terminal/xtermAssets.generated';

describe('terminal document', () => {
  it('builds the production WebView document', () => {
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
    expect(production).toContain('prepareOutput');
    expect(production).toContain('hardenTerminalTextarea');
    expect(production).toContain('focusTerminalInput');
    expect(production).toContain('data-seq="ENTER">&#9166;</button>');
    expect(production).toContain("ENTER:'\\r'");
    expect(production).toContain("CTRL_C:'\\x03'");
    expect(production).toContain('data-seq="CTRL_C">Ctrl+C</button>');
    expect(production).not.toContain('data-seq="HOME"');
    expect(production).toContain('sgrMouseClickSequence');
    expect(production).toContain('sgrMouseWheelSequence');
    expect(production).toContain('restoreTerminalMouseControls');
    expect(TERMINAL_HELPERS_JS).toContain('MOBILY_SHELL_PROMPT');
    expect(production).toContain("msg.type==='keyboard'");
    expect(production).toContain("addEventListener('touchstart'");
    expect(production).toContain('capture:true');
    expect(production).toContain('touchmove');
    expect(production).toContain("msg.type==='paste'");
    expect(production).toContain('proposeOwnerGrid');
    expect(production).toContain("sendRN({type:'resize'");
    expect(production).toContain("msg.type==='fit')fitView()");
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
    expect(fitTerminalScale(360, 720, 12_000, 640)).toBe(0.03);
    expect(clampTerminalScale(0.05)).toBe(0.2);
    expect(clampTerminalScale(4)).toBe(3);
    expect(clampTerminalScale(1.25)).toBe(1.25);
    expect(pinchTerminalScale(0.5, 100, 200)).toBe(1);
    expect(pinchTerminalScale(2, 100, 400)).toBe(3);
  });

  it('strips mouse modes for workstation embeds while Android tracking preserves them', () => {
    const fixture = '\u001b[2J\u001b[31mwide TUI\u001b[0m\u001b[?1002;1049h';
    expect(stripTerminalMouseControls(fixture)).toBe(
      '\u001b[2J\u001b[31mwide TUI\u001b[0m\u001b[?1049h',
    );

    const state = createTerminalMouseModeState();
    expect(isTerminalMouseReportingActive(state)).toBe(false);
    expect(applyTerminalMouseControls(state, fixture)).toBe(fixture);
    expect(isTerminalMouseReportingActive(state)).toBe(true);
    applyTerminalMouseControls(state, '\u001b[?1000;1002h');
    applyTerminalMouseControls(state, '\u001b[?1000l');
    expect(isTerminalMouseReportingActive(state)).toBe(true);
    applyTerminalMouseControls(state, '\u001b[?1002l');
    expect(isTerminalMouseReportingActive(state)).toBe(false);

    applyTerminalMouseControls(state, '\u001b[?1000;1006;1049h');
    expect(isTerminalMouseReportingActive(state)).toBe(true);
    applyTerminalMouseControls(state, '\u001b[?1049l');
    expect(isTerminalMouseReportingActive(state)).toBe(false);
  });

  it('clears stale mouse reporting when the Mobily shell prompt returns across chunks', () => {
    const state = createTerminalMouseModeState();
    applyTerminalMouseControls(state, '\u001b[?1000;1006h');
    expect(isTerminalMouseReportingActive(state)).toBe(true);

    applyTerminalMouseControls(state, '\r\n[mob');
    expect(isTerminalMouseReportingActive(state)).toBe(true);
    applyTerminalMouseControls(state, 'ily] kiran@station:~$ ');
    expect(isTerminalMouseReportingActive(state)).toBe(false);

    applyTerminalMouseControls(state, '\r\n[mobily] shell$ \u001b[?1002;1006h');
    expect(isTerminalMouseReportingActive(state)).toBe(true);
  });

  it('formats SGR mouse click press and release sequences', () => {
    expect(sgrMouseClickSequence(0, 0)).toBe('\u001b[<0;1;1M\u001b[<0;1;1m');
    expect(sgrMouseClickSequence(42, 11)).toBe('\u001b[<0;43;12M\u001b[<0;43;12m');
  });

  it('restores active historical mouse tracking with SGR coordinates', () => {
    expect(restoreTerminalMouseControls('\u001b[?1003;1006h')).toBe('\u001b[?1003;1006h');
    expect(restoreTerminalMouseControls('\u001b[?1000;1002h\u001b[?1000l')).toBe(
      '\u001b[?1002;1006h',
    );
    expect(restoreTerminalMouseControls('\u001b[?1003h\u001b[?1049l')).toBe('');
  });

  it('formats SGR mouse wheel sequences', () => {
    expect(sgrMouseWheelSequence('up', 0, 0)).toBe('\u001b[<64;1;1M');
    expect(sgrMouseWheelSequence('down', 42, 11)).toBe('\u001b[<65;43;12M');
  });

  it('focuses the helper textarea for soft-keyboard input', () => {
    const calls: string[] = [];
    const textarea = { focus: () => calls.push('textarea') };
    focusTerminalInput({
      focus: () => calls.push('term'),
      textarea,
    });
    expect(calls).toEqual(['term', 'textarea']);
    expect(() => focusTerminalInput(null)).not.toThrow();
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
