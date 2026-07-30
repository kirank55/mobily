import { describe, expect, it, vi } from 'vitest';

import { AutomaticTerminalSizeOwnership } from '../src/terminal/automaticTerminalSizeOwnership';

describe('automatic terminal size ownership', () => {
  it('claims a connected Session, applies the readable grid, and releases on exit', () => {
    const claim = vi.fn();
    const release = vi.fn();
    const sendResize = vi.fn();
    const setViewOwnership = vi.fn();
    const ownership = new AutomaticTerminalSizeOwnership({
      claim,
      release,
      sendResize,
    });
    ownership.subscribeViewOwnership(setViewOwnership);

    ownership.setViewReady();
    ownership.setConnected(true);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(setViewOwnership).toHaveBeenLastCalledWith(false);

    ownership.setOwnedByRequester(true);
    expect(setViewOwnership).toHaveBeenLastCalledWith(true);

    ownership.proposeGrid(45, 42);
    expect(sendResize).toHaveBeenCalledWith(45, 42);

    ownership.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(setViewOwnership).toHaveBeenLastCalledWith(false);
  });

  it('does not resize before ownership is granted and reclaims after reconnecting', () => {
    const claim = vi.fn();
    const release = vi.fn();
    const sendResize = vi.fn();
    const setViewOwnership = vi.fn();
    const ownership = new AutomaticTerminalSizeOwnership({
      claim,
      release,
      sendResize,
    });
    ownership.subscribeViewOwnership(setViewOwnership);

    ownership.setConnected(true);
    ownership.proposeGrid(45, 42);
    expect(sendResize).not.toHaveBeenCalled();

    ownership.setOwnedByRequester(true);
    ownership.setConnected(false);
    ownership.setViewReady();
    expect(setViewOwnership).toHaveBeenLastCalledWith(false);

    ownership.setConnected(true);
    expect(claim).toHaveBeenCalledTimes(2);
    ownership.setOwnedByRequester(true);
    ownership.proposeGrid(44, 30);
    expect(sendResize).toHaveBeenCalledWith(44, 30);
  });
});
