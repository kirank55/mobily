import { describe, expect, it } from 'vitest';
import {
  MouseReportingGuard,
  MOUSE_REPORTING_BOUNDARY_FLUSH,
  MOBILY_SHELL_PROMPT,
} from '../src/mouseReportingGuard.js';

const PROMPT = '[mobily] $ ';
const SGR_MOTION = '\x1b[<35;5;3M';
const SGR_CLICK = '\x1b[<0;5;3M\x1b[<0;5;3m';
const SGR_WHEEL = '\x1b[<64;10;5M';

describe('MouseReportingGuard', () => {
  it('does not flush at a prompt that no mouse-enabled TUI preceded', () => {
    const guard = new MouseReportingGuard();
    expect(guard.trackOutput(PROMPT)).toBe(false);
  });

  it('does not flush when the TUI session used the keyboard only', () => {
    const guard = new MouseReportingGuard();
    guard.trackOutput('\x1b[?1049h\x1b[?1003h\x1b[?1006h');
    expect(guard.trackInput('q')).toBe(true);
    expect(guard.trackOutput('\x1b[?1003l\x1b[?1006l\x1b[?1049l\r\n' + PROMPT)).toBe(false);
  });

  it('flushes at the prompt boundary after pure mouse input, once', () => {
    const guard = new MouseReportingGuard();
    guard.trackOutput('\x1b[?1003h\x1b[?1006h');
    expect(guard.trackInput(SGR_MOTION + SGR_MOTION)).toBe(true);
    expect(guard.trackOutput('Killed\r\n' + PROMPT)).toBe(true);
    // Disarmed: later prompts (e.g. after the flush interrupt) must not refire.
    expect(guard.trackOutput(PROMPT)).toBe(false);
  });

  it('still flushes when the TUI clears mouse modes and the alternate screen before exiting', () => {
    const guard = new MouseReportingGuard();
    guard.trackOutput('\x1b[?1049h\x1b[?1003h\x1b[?1006h');
    guard.trackInput(SGR_CLICK);
    // Packets queued while stalled predate this DECRST; only the prompt proves
    // the shell — not a still-running TUI — is the reader.
    expect(guard.trackOutput('\x1b[?1003l\x1b[?1006l\x1b[?1049l')).toBe(false);
    expect(guard.trackOutput('\r\n' + PROMPT)).toBe(true);
  });

  it('arms from any of the click, drag, and motion DECSET params', () => {
    for (const sequence of ['\x1b[?1000h', '\x1b[?1002h', '\x1b[?1002;1006h', '\x1b[?1003h']) {
      const guard = new MouseReportingGuard();
      guard.trackOutput(sequence);
      guard.trackInput(SGR_CLICK);
      expect(guard.trackOutput(PROMPT)).toBe(true);
    }
  });

  it('stitches DECSET and the prompt across output chunks', () => {
    const guard = new MouseReportingGuard();
    guard.trackOutput('\x1b[?10');
    expect(guard.trackOutput('03h')).toBe(false);
    guard.trackInput(SGR_MOTION);
    expect(guard.trackOutput('[mob')).toBe(false);
    expect(guard.trackOutput('ily] $ ')).toBe(true);
  });

  it('re-arms when a later TUI takes mouse ownership again', () => {
    const guard = new MouseReportingGuard();
    guard.trackOutput('\x1b[?1003h');
    guard.trackInput(SGR_MOTION);
    expect(guard.trackOutput(PROMPT)).toBe(true);
    guard.trackOutput('\x1b[?1002h');
    guard.trackInput(SGR_CLICK);
    expect(guard.trackOutput(PROMPT)).toBe(true);
  });

  it('drops pure mouse packets only inside the post-boundary suppression window', () => {
    let now = 1_000;
    const guard = new MouseReportingGuard({ suppressionWindowMs: 1500, now: () => now });
    guard.trackOutput('\x1b[?1003h');
    expect(guard.trackInput(SGR_MOTION)).toBe(true);
    expect(guard.trackOutput(PROMPT)).toBe(true);

    // Stale in-flight packets right after the boundary are dropped...
    now = 2_000;
    expect(guard.trackInput(SGR_MOTION)).toBe(false);
    expect(guard.trackInput(SGR_CLICK + SGR_WHEEL)).toBe(false);
    // ...mixed frames always forward (never mouse-only)...
    expect(guard.trackInput(SGR_MOTION + 'x')).toBe(true);
    // ...and mouse frames outside the window forward (mid-TUI reattach).
    now = 3_000;
    expect(guard.trackInput(SGR_MOTION)).toBe(true);
  });

  it('forwards pure mouse input without a boundary when never armed', () => {
    const guard = new MouseReportingGuard();
    expect(guard.trackInput(SGR_CLICK)).toBe(true);
  });

  it('ends the suppression window when a TUI re-arms mouse reporting', () => {
    const now = 1_000;
    const guard = new MouseReportingGuard({ suppressionWindowMs: 60_000, now: () => now });
    guard.trackOutput('\x1b[?1003h');
    guard.trackInput(SGR_MOTION);
    expect(guard.trackOutput(PROMPT)).toBe(true);
    guard.trackOutput('\x1b[?1003h');
    expect(guard.trackInput(SGR_MOTION)).toBe(true);
  });

  it('recognizes X10 and urxvt mouse reports as mouse input', () => {
    const x10 = '\x1b[M' + String.fromCharCode(0x20, 0x25, 0x23);
    const urxvt = '\x1b[35;5;3M';
    for (const packet of [x10, urxvt]) {
      const guard = new MouseReportingGuard();
      guard.trackOutput('\x1b[?1003h');
      expect(guard.trackInput(packet)).toBe(true);
      expect(guard.trackOutput(PROMPT)).toBe(true);
    }
  });

  it('flushes with VINTR so the line discipline discards the queued input', () => {
    expect(MOUSE_REPORTING_BOUNDARY_FLUSH).toBe('\x03');
    expect(MOBILY_SHELL_PROMPT).toBe('[mobily] ');
  });
});
