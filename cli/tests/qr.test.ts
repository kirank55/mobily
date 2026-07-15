/**
 * cli/tests/qr.test.ts
 *
 * Unit tests for terminal QR rendering of the pairing code.
 */

import { describe, expect, it } from 'vitest';
import { renderTerminalQr } from '../src/qr.js';

describe('renderTerminalQr()', () => {
  it('returns a non-empty string for a short pairing code', async () => {
    const qr = await renderTerminalQr('ABCD2345');
    expect(typeof qr).toBe('string');
    expect(qr.length).toBeGreaterThan(0);
  });

  it('uses half-block Unicode modules for compact terminal rendering', async () => {
    const qr = await renderTerminalQr('ABCD2345');
    expect(qr).toMatch(/[▀▄█]/);
  });

  it('forces a white background so it scans on any terminal theme', async () => {
    const qr = await renderTerminalQr('ABCD2345');
    // ANSI 47 = white background, 30 = black foreground.
    expect(qr).toContain('\u001b[47m');
    expect(qr).toContain('\u001b[30m');
  });

  it('produces different output for different codes', async () => {
    const a = await renderTerminalQr('ABCD2345');
    const b = await renderTerminalQr('WXYZ6789');
    expect(a).not.toBe(b);
  });
});
