import { afterEach, describe, expect, it, vi } from 'vitest';

import { TerminalSizeOwnershipController } from '@/terminal/sizeOwnership';

afterEach(() => {
  vi.useRealTimers();
});

describe('TerminalSizeOwnershipController', () => {
  it('claims only for a connected, visible, active terminal and refreshes its lease', () => {
    vi.useFakeTimers();
    const claim = vi.fn();
    const release = vi.fn();
    const ownership = new TerminalSizeOwnershipController(
      { claim, release },
      { releaseDebounceMs: 250, leaseRefreshMs: 5_000 },
    );

    ownership.setAppActive(true);
    ownership.setConnected(true);
    ownership.setTerminalVisible(true);
    expect(claim).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5_000);
    expect(claim).toHaveBeenCalledTimes(2);

    ownership.setAppActive(false);
    vi.advanceTimersByTime(249);
    ownership.setAppActive(true);
    expect(release).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('debounces background release and requires a fresh claim after reconnect', () => {
    vi.useFakeTimers();
    const claim = vi.fn();
    const release = vi.fn();
    const ownership = new TerminalSizeOwnershipController(
      { claim, release },
      { releaseDebounceMs: 250, leaseRefreshMs: 5_000 },
    );
    ownership.setAppActive(true);
    ownership.setConnected(true);
    ownership.setTerminalVisible(true);

    ownership.setAppActive(false);
    vi.advanceTimersByTime(250);
    expect(release).toHaveBeenCalledOnce();

    ownership.setConnected(false);
    ownership.setAppActive(true);
    ownership.setConnected(true);
    expect(claim).toHaveBeenCalledTimes(2);

    ownership.setTerminalVisible(false);
    vi.advanceTimersByTime(250);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
