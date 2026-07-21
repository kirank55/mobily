import type { SessionSnapshotFrame } from '@mobily/shared';

type SnapshotListener = (snapshot: SessionSnapshotFrame) => void;

/** Publishes Session Snapshots and replays the latest one to late subscribers. */
export class SessionSnapshotChannel {
  private latest: SessionSnapshotFrame | null = null;
  private readonly listeners = new Set<SnapshotListener>();

  publish(snapshot: SessionSnapshotFrame): void {
    this.latest = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.latest = null;
  }
}
