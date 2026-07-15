import { foregroundNotification } from './foreground';
import { latestTerminalLine, notificationText } from './text';

export interface ForegroundNotification {
  requestNotificationPermission(): Promise<boolean>;
  start(stationName: string): Promise<void>;
  update(state: string, lastLine: string, alert?: string): Promise<void>;
  stop(): Promise<void>;
}

export class ForegroundConnectionController {
  private generation = 0;
  private started = false;
  private state = 'connecting';
  private lastLine = 'Waiting for terminal output';
  private outputTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly notifications: ForegroundNotification = foregroundNotification,
    private readonly outputUpdateDelayMs = 250,
  ) {}

  async connect(stationName: string): Promise<void> {
    const generation = ++this.generation;
    this.state = 'connecting';
    this.lastLine = 'Waiting for terminal output';
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

  async updateState(state: string): Promise<void> {
    this.state = notificationText(state, 40, 'connected');
    await this.safeUpdate();
  }

  recordOutput(data: string): void {
    const latestLine = latestTerminalLine(data);
    if (latestLine) this.lastLine = latestLine;
    if (!this.started || this.outputTimer) return;
    this.outputTimer = setTimeout(() => {
      this.outputTimer = null;
      void this.safeUpdate();
    }, this.outputUpdateDelayMs);
  }

  async alert(message: string): Promise<void> {
    await this.safeUpdate(notificationText(message, 512));
  }

  async disconnect(): Promise<void> {
    this.generation++;
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
    this.started = false;
    await this.queueLifecycle(() => this.safeStop());
  }

  private async safeUpdate(alert?: string): Promise<void> {
    if (!this.started) return;
    try {
      await this.notifications.update(this.state, this.lastLine, alert);
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
