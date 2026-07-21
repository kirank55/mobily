import type { SessionSnapshotFrame } from '@mobily/shared';
import { describe, expect, it, vi } from 'vitest';

import { SessionSnapshotChannel } from '@/client/sessionSnapshotChannel';

describe('SessionSnapshotChannel', () => {
  it('immediately gives a late subscriber the latest Session Snapshot', () => {
    const channel = new SessionSnapshotChannel();
    const listener = vi.fn();
    const snapshot = sessionSnapshot('ready');

    channel.publish(snapshot);
    channel.subscribe(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(snapshot);
  });

  it('does not replay a snapshot after the Station connection is reset', () => {
    const channel = new SessionSnapshotChannel();
    const listener = vi.fn();

    channel.publish(sessionSnapshot('stale'));
    channel.reset();
    channel.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
  });
});

function sessionSnapshot(chars: string): SessionSnapshotFrame {
  return {
    type: 'session-snapshot',
    cols: chars.length,
    rows: 1,
    activeScreen: 'normal',
    cursor: { col: 0, row: 0, visible: true, style: 'block', blink: false },
    grid: [Array.from(chars, (value) => ({ chars: value, width: 1 }))],
  };
}
