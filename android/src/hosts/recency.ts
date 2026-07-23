import type { PairingRecord } from '@/auth/storage';

export interface PairingSection {
  title: 'Today' | 'Yesterday' | 'Earlier';
  data: PairingRecord[];
}

export function pairingActivityAt(record: PairingRecord): number {
  return record.lastConnectedAt ?? record.pairedAt;
}

export function buildPairingSections(
  pairings: readonly PairingRecord[],
  now = Date.now(),
): PairingSection[] {
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const buckets: Record<PairingSection['title'], PairingRecord[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };
  for (const pairing of [...pairings].sort((a, b) => pairingActivityAt(b) - pairingActivityAt(a))) {
    const activityAt = pairingActivityAt(pairing);
    const title =
      activityAt >= todayStart
        ? 'Today'
        : activityAt >= yesterdayStart.getTime()
          ? 'Yesterday'
          : 'Earlier';
    buckets[title].push(pairing);
  }

  return (['Today', 'Yesterday', 'Earlier'] as const)
    .filter((title) => buckets[title].length > 0)
    .map((title) => ({ title, data: buckets[title] }));
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
