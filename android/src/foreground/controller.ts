import { foregroundNotification } from './foreground';
import type { ConnectionState } from '@/client/wsClient';
import type { SessionPhase } from '@mobily/shared';

export interface ForegroundNotification {
  requestNotificationPermission(): Promise<boolean>;
  start(stationName: string): Promise<void>;
  update(state: string, phase: string, alert?: boolean): Promise<void>;
  stop(): Promise<void>;
}

export class ForegroundConnectionController {
  private generation = 0;
  private started = false;
  private state: ConnectionState = 'connecting';
  private phase: SessionPhase | '' = '';
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(private readonly notifications: ForegroundNotification = foregroundNotification) {}

  async connect(stationName: string): Promise<void> {
    const generation = ++this.generation;
    this.state = 'connecting';
    this.phase = '';
    try {
      await this.notifications.requestNotificationPermission();
    } catch {
      // Notification permission is optional; Android still requires an FGS notification.
    }
    if (generation !== this.generation) return;

    await this.queueLifecycle(async () => {
      if (generation !== this.generation) return;
      try {
        await this.notifications.start(stationName);
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

  async updatePhase(phase: SessionPhase, _detail?: string): Promise<void> {
    this.phase = phase;
    await this.safeUpdate();
  }

  async alert(_message: string): Promise<void> {
    await this.safeUpdate(true);
  }

  async disconnect(): Promise<void> {
    this.generation++;
    this.started = false;
    this.phase = '';
    await this.queueLifecycle(() => this.safeStop());
  }

  private async safeUpdate(alert = false): Promise<void> {
    if (!this.started) return;
    try {
      await this.notifications.update(this.state, this.phase, alert);
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
