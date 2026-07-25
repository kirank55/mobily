import { describe, expect, it } from 'vitest';
import { parseDeviceBindingId } from '@mobily/shared';

import type { PairingRecord } from '@/auth/storage';
import { buildPairingSections } from '@/stations/recency';

function record(name: string, activityAt: number): PairingRecord {
  return {
    stationName: name,
    tunnelUrl: `wss://${name}.example.test`,
    deviceBindingId: parseDeviceBindingId(`binding_${name.padEnd(22, 'A')}`)!,
    keyAlias: `mobily_${name}`,
    pairedAt: activityAt,
    lastConnectedAt: activityAt,
  };
}

describe('Station recency sections', () => {
  it('orders today before yesterday and each section newest first', () => {
    const now = new Date(2026, 6, 23, 12).getTime();
    const sections = buildPairingSections(
      [
        record('yesterday', new Date(2026, 6, 22, 18).getTime()),
        record('newest', new Date(2026, 6, 23, 11).getTime()),
        record('older', new Date(2026, 6, 23, 8).getTime()),
      ],
      now,
    );

    expect(sections.map((section) => section.title)).toEqual(['Today', 'Yesterday']);
    expect(sections[0]?.data.map((entry) => entry.stationName)).toEqual(['newest', 'older']);
    expect(sections[1]?.data.map((entry) => entry.stationName)).toEqual(['yesterday']);
  });
});
