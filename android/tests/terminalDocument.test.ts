import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildTerminalDocument,
  clampTerminalScale,
  fitTerminalScale,
  pinchTerminalScale,
  stripTerminalMouseControls,
  terminalSelectionRange,
} from '../src/terminal/terminalDocument';

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
    expect(production).toContain("msg.type==='selection-mode'");
    expect(production).toContain('stripMouseModes');
    expect(production).toContain('touchmove');
    expect(production).toContain("msg.type==='paste'");
    expect(production).toContain('new ResizeObserver(function(){fitView();})');
    expect(production).not.toContain("sendRN({type:'resize'");
    expect(readFileSync(resolve(__dirname, '../dev/term.html'), 'utf8')).toContain(
      '[mobily harness] terminal ready',
    );
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
    const fixture = '\u001b[2J\u001b[31mwide TUI\u001b[0m\u001b[?1002;1006h';
    expect(stripTerminalMouseControls(fixture)).toBe('\u001b[2J\u001b[31mwide TUI\u001b[0m');
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
