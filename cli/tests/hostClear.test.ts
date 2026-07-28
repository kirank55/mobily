import { describe, expect, it } from 'vitest';
import { clearHostTerminal, HOST_TERMINAL_CLEAR } from '../src/terminal/hostClear.js';

describe('clearHostTerminal()', () => {
  it('writes a portable ANSI clear that works on Windows Terminal, macOS, and Linux', () => {
    const chunks: string[] = [];
    clearHostTerminal({ write: (data) => chunks.push(data) });

    expect(HOST_TERMINAL_CLEAR).toBe('\u001b[2J\u001b[3J\u001b[H');
    expect(chunks).toEqual([HOST_TERMINAL_CLEAR]);
  });
});
