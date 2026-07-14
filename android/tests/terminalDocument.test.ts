import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildTerminalDocument } from '../src/terminal/terminalDocument';

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
    expect(readFileSync(resolve(__dirname, '../dev/term.html'), 'utf8')).toContain(
      '[mobily harness] terminal ready',
    );
  });
});
