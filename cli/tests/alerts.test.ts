import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalAlertDetector } from '../src/alerts/detector.js';

describe('TerminalAlertDetector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits bounded plain-text prompt alerts and suppresses duplicates', () => {
    const alerts: string[] = [];
    const detector = new TerminalAlertDetector((message) => alerts.push(message));

    detector.push('\x1b[33mApprove tool call?\x1b[0m\r\n');
    detector.push('Approve tool call?\r\n');

    expect(alerts).toEqual(['Approve tool call?']);
    detector.dispose();
  });

  it('emits an idle alert containing the last meaningful line', async () => {
    vi.useFakeTimers();
    const alerts: string[] = [];
    const detector = new TerminalAlertDetector((message) => alerts.push(message), {
      idleTimeoutMs: 5_000,
    });

    detector.push('Build completed\r\n');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(alerts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(alerts).toEqual(['Station idle: Build completed']);
    detector.dispose();
  });

  it('cancels idle work when disposed', async () => {
    vi.useFakeTimers();
    const onAlert = vi.fn();
    const detector = new TerminalAlertDetector(onAlert, { idleTimeoutMs: 100 });
    detector.push('Working\n');
    detector.dispose();

    await vi.advanceTimersByTimeAsync(100);
    expect(onAlert).not.toHaveBeenCalled();
  });
});
