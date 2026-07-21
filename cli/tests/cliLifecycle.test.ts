import { describe, expect, it, vi } from 'vitest';

import {
  CLI_SHUTDOWN_TIMEOUT_MS,
  CliLifecycle,
  type CliCleanup,
  type CliLifecycleRuntime,
} from '../src/cliLifecycle.js';

class FakeLifecycleRuntime implements CliLifecycleRuntime {
  readonly listeners = new Map<'SIGINT' | 'SIGTERM', Set<() => void>>();
  readonly output: string[] = [];
  readonly errors: string[] = [];
  readonly exits: number[] = [];
  deadline: (() => void) | undefined;
  deadlineMs: number | undefined;

  onSignal(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
  }

  offSignal(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void {
    this.listeners.get(signal)?.delete(listener);
  }

  setDeadline(listener: () => void, delayMs: number): unknown {
    this.deadline = listener;
    this.deadlineMs = delayMs;
    return listener;
  }

  clearDeadline(deadline: unknown): void {
    if (this.deadline === deadline) this.deadline = undefined;
  }

  write(message: string): void {
    this.output.push(message);
  }

  writeError(message: string): void {
    this.errors.push(message);
  }

  exit(code: number): void {
    this.exits.push(code);
  }

  emit(signal: 'SIGINT' | 'SIGTERM'): void {
    for (const listener of this.listeners.get(signal) ?? []) listener();
  }

  expireDeadline(): void {
    this.deadline?.();
  }
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CliLifecycle', () => {
  it('routes normal completion through cleanup and removes recovery state on success', async () => {
    const runtime = new FakeLifecycleRuntime();
    const lifecycle = new CliLifecycle(runtime);
    const events: string[] = [];
    let ownershipRecorded = true;
    lifecycle.setCleanup({
      temporaryTunnel: true,
      stopNewWork: () => events.push('stopped'),
      run: async () => {
        events.push('cleaned');
        ownershipRecorded = false;
      },
    });

    await lifecycle.requestShutdown('Session exited');

    expect(events).toEqual(['stopped', 'cleaned']);
    expect(ownershipRecorded).toBe(false);
    expect(runtime.output.join('')).toContain('Cleaning up Temporary Tunnel');
    expect(runtime.deadlineMs).toBe(CLI_SHUTDOWN_TIMEOUT_MS);
    expect(runtime.exits).toEqual([0]);
  });

  it('waits on the first signal and force-exits on the second without duplicate cleanup', async () => {
    const runtime = new FakeLifecycleRuntime();
    const lifecycle = new CliLifecycle(runtime);
    const cleaning = deferred();
    let cleanupRuns = 0;
    let ownershipRecorded = true;
    let cleanupSignal: AbortSignal | undefined;
    const cleanup: CliCleanup = {
      temporaryTunnel: true,
      stopNewWork: vi.fn(),
      run: async (signal) => {
        cleanupRuns += 1;
        cleanupSignal = signal;
        await cleaning.promise;
        if (!signal.aborted) ownershipRecorded = false;
      },
    };
    lifecycle.setCleanup(cleanup);
    lifecycle.installSignalHandlers();

    runtime.emit('SIGINT');
    await Promise.resolve();
    expect(cleanup.stopNewWork).toHaveBeenCalledOnce();
    expect(runtime.exits).toEqual([]);

    runtime.emit('SIGINT');
    expect(cleanupSignal?.aborted).toBe(true);
    expect(runtime.exits).toEqual([130]);
    expect(runtime.errors.join('')).toContain('recovery will resume on the next run');

    cleaning.resolve();
    await Promise.resolve();
    expect(cleanupRuns).toBe(1);
    expect(ownershipRecorded).toBe(true);
    expect(runtime.exits).toEqual([130]);
  });

  it('force-exits at the ten-second deadline and preserves recovery state', async () => {
    const runtime = new FakeLifecycleRuntime();
    const lifecycle = new CliLifecycle(runtime);
    const cleaning = deferred();
    let ownershipRecorded = true;
    lifecycle.setCleanup({
      temporaryTunnel: true,
      stopNewWork: vi.fn(),
      run: async (signal) => {
        await cleaning.promise;
        if (!signal.aborted) ownershipRecorded = false;
      },
    });

    const shutdown = lifecycle.requestShutdown('SIGTERM received', 143);
    await Promise.resolve();
    expect(runtime.deadlineMs).toBe(10_000);

    runtime.expireDeadline();
    expect(runtime.exits).toEqual([143]);
    expect(runtime.errors.join('')).toContain('timed out after 10 seconds');

    cleaning.resolve();
    await shutdown;
    expect(ownershipRecorded).toBe(true);
    expect(runtime.exits).toEqual([143]);
  });

  it('preserves recovery state and reports the next-start action when cleanup fails', async () => {
    const runtime = new FakeLifecycleRuntime();
    const lifecycle = new CliLifecycle(runtime);
    const ownershipRecorded = true;
    lifecycle.setCleanup({
      temporaryTunnel: true,
      stopNewWork: vi.fn(),
      run: async () => {
        throw new Error('provider unavailable');
      },
    });

    await lifecycle.requestShutdown('Session exited');

    expect(ownershipRecorded).toBe(true);
    expect(runtime.exits).toEqual([1]);
    expect(runtime.errors.join('')).toContain(
      'Temporary Tunnel cleanup failed: Mobily failed: provider unavailable',
    );
    expect(runtime.errors.join('')).toContain('Recovery will run on the next start');
  });

  it('routes a top-level startup failure through the configured bounded cleanup', async () => {
    const runtime = new FakeLifecycleRuntime();
    const lifecycle = new CliLifecycle(runtime);
    const cleanup = vi.fn(async () => {});
    lifecycle.setCleanup({
      temporaryTunnel: true,
      stopNewWork: vi.fn(),
      run: cleanup,
    });

    await lifecycle.fail(new Error('QR rendering crashed'), false);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(runtime.errors[0]).toContain('Mobily failed: QR rendering crashed');
    expect(runtime.exits).toEqual([1]);
  });
});
