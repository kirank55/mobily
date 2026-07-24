import { foregroundNotification } from './foreground';
import type { ConnectionState } from '@/client/wsClient';
import type { SessionPhase } from '@mobily/shared';

export interface ForegroundNotification {
  requestNotificationPermission(): Promise<boolean>;
  start(): Promise<void>;
  update(connected: boolean): Promise<void>;
  stop(): Promise<void>;
}

export class ForegroundConnectionController {
  private generation = 0;
  private started = false;
  private state: ConnectionState = 'connecting';
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(private readonly notifications: ForegroundNotification = foregroundNotification) {}

  async connect(_stationName: string): Promise<void> {
    const generation = ++this.generation;
    this.state = 'connecting';
    try {
      await this.notifications.requestNotificationPermission();
    } catch {
      // Notification permission is optional; Android still requires an FGS notification.
    }
    if (generation !== this.generation) return;

    await this.queueLifecycle(async () => {
      if (generation !== this.generation) return;
      try {
        await this.notifications.start();
        if (generation !== this.generation) {
          await this.safeStop();
          return;
        }
        this.started = true;
        await this.safeUpdate();
      } catch {
        this.started = false;
      }
    });
  }

  async updateState(state: ConnectionState): Promise<void> {
    this.state = state;
    await this.safeUpdate();
  }

  async updatePhase(_phase: SessionPhase, _detail?: string): Promise<void> {}

  async alert(_message: string): Promise<void> {}

  async disconnect(): Promise<void> {
    this.generation++;
    this.started = false;
    await this.queueLifecycle(() => this.safeStop());
  }

  private async safeUpdate(): Promise<void> {
    if (!this.started) return;
    try {
      await this.notifications.update(this.state === 'connected');
    } catch {
      // Notification failures must never interrupt terminal connectivity.
    }
  }

  private async safeStop(): Promise<void> {
    try {
      await this.notifications.stop();
    } catch {
      // The service may not have started yet.
    }
  }

  private async queueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycleQueue.then(operation, operation);
    this.lifecycleQueue = result.catch(() => undefined);
    await result;
  }
}
