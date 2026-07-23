import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionPhase } from '@mobily/shared';
import { SessionPhaseTracker } from '../src/alerts/phase.js';

describe('SessionPhaseTracker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function createTracker() {
    const phases: Array<{ phase: SessionPhase; detail?: string }> = [];
    const alerts: string[] = [];
    const tracker = new SessionPhaseTracker({
      onPhase: (phase, detail) => phases.push({ phase, ...(detail === undefined ? {} : { detail }) }),
      onAlert: (message) => alerts.push(message),
    });
    return { tracker, phases, alerts };
  }

  it('marks streaming output as working', () => {
    const { tracker, phases, alerts } = createTracker();
    tracker.push('Thinking about the change...\r\n');
    expect(phases).toEqual([{ phase: 'working', detail: 'Thinking about the change...' }]);
    expect(alerts).toEqual([]);
    tracker.dispose();
  });

  it('transitions to waiting and emits an alert for prompt-like lines', () => {
    const { tracker, phases, alerts } = createTracker();
    tracker.push('compiling\r\n');
    tracker.push('Approve tool call?\r\n');
    expect(phases).toEqual([
      { phase: 'working', detail: 'compiling' },
      { phase: 'waiting', detail: 'Approve tool call?' },
    ]);
    expect(alerts).toEqual(['Approve tool call?']);
    tracker.dispose();
  });

  it('transitions to finished on completion phrases after working', () => {
    const { tracker, phases } = createTracker();
    tracker.push('Running tests\r\n');
    tracker.push('Build completed\r\n');
    expect(phases.map((entry) => entry.phase)).toEqual(['working', 'finished']);
    tracker.dispose();
  });

  it('treats a shell prompt after working as finished', () => {
    const { tracker, phases } = createTracker();
    tracker.push('Applying patch\r\n');
    tracker.push('kiran@host:~$ \r\n');
    expect(phases.map((entry) => entry.phase)).toEqual(['working', 'finished']);
    tracker.dispose();
  });

  it('emits idle phase and alert after silence', async () => {
    vi.useFakeTimers();
    const phases: Array<{ phase: SessionPhase; detail?: string }> = [];
    const alerts: string[] = [];
    const tracker = new SessionPhaseTracker(
      {
        onPhase: (phase, detail) => phases.push({ phase, ...(detail === undefined ? {} : { detail }) }),
        onAlert: (message) => alerts.push(message),
      },
      { idleTimeoutMs: 5_000 },
    );

    tracker.push('Build completed\r\n');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(phases.map((entry) => entry.phase)).toEqual(['finished', 'idle']);
    expect(alerts).toEqual(['Station idle: Build completed']);
    tracker.dispose();
  });

  it('does not re-emit the same phase while detail changes', () => {
    const { tracker, phases } = createTracker();
    tracker.push('line one\r\n');
    tracker.push('line two\r\n');
    expect(phases).toEqual([{ phase: 'working', detail: 'line one' }]);
    tracker.dispose();
  });
});
