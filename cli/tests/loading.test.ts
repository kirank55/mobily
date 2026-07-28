import { describe, expect, it, vi } from 'vitest';
import { startLineLoading } from '../src/loading.js';

describe('startLineLoading()', () => {
  it('prints a static line when not a TTY', () => {
    const chunks: string[] = [];
    const stop = startLineLoading('Preparing pairing QR…', {
      isTTY: false,
      write: (chunk) => chunks.push(chunk),
    });
    expect(chunks).toEqual(['Preparing pairing QR…\n']);
    stop();
    expect(chunks).toEqual(['Preparing pairing QR…\n']);
  });

  it('animates on a TTY and clears the line when stopped', () => {
    const chunks: string[] = [];
    const timers: Array<() => void> = [];
    const stop = startLineLoading('Preparing pairing QR…', {
      isTTY: true,
      write: (chunk) => chunks.push(chunk),
      setInterval: ((handler: () => void) => {
        timers.push(handler);
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof setInterval,
      clearInterval: vi.fn(),
    });

    expect(chunks[0]).toBe('⠋ Preparing pairing QR…');
    timers[0]?.();
    expect(chunks.at(-1)).toBe('\r⠙ Preparing pairing QR…');

    stop();
    const clearLine = '\r\u001b[K';
    expect(chunks.at(-1)).toBe(clearLine);
    stop();
    expect(chunks.filter((chunk) => chunk === clearLine)).toHaveLength(1);
  });
});
