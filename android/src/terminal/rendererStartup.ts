export type RendererStartupState = 'loading' | 'ready' | 'failed';

export interface RendererStartupPresentation {
  readonly message: string;
  readonly canRetry: boolean;
}

interface RendererStartupOptions {
  readonly sendProbe: () => void;
  readonly onStateChange: (state: RendererStartupState) => void;
  readonly onReady: () => void;
  readonly probeIntervalMs?: number;
  readonly timeoutMs?: number;
}

export const RENDERER_READY_PROBE_INTERVAL_MS = 100;
export const RENDERER_READY_TIMEOUT_MS = 5_000;

export function rendererStartupPresentation(
  state: RendererStartupState,
): RendererStartupPresentation | null {
  switch (state) {
    case 'loading':
      return { message: 'Loading terminal renderer…', canRetry: false };
    case 'failed':
      return { message: 'Terminal renderer failed to start', canRetry: true };
    case 'ready':
      return null;
  }
}

/**
 * Coordinates the native side of terminal renderer startup.
 *
 * A renderer-ready message is accepted only after the current document has
 * finished loading. This prevents a late message from the previous document
 * from completing a reload, while repeated probes recover a missed initial
 * ready message from the new document.
 */
export class TerminalRendererStartup {
  private readonly sendProbe: () => void;
  private readonly onStateChange: (state: RendererStartupState) => void;
  private readonly onReady: () => void;
  private readonly probeIntervalMs: number;
  private readonly timeoutMs: number;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private pageDidLoad = false;
  private state: RendererStartupState = 'loading';

  constructor(options: RendererStartupOptions) {
    this.sendProbe = options.sendProbe;
    this.onStateChange = options.onStateChange;
    this.onReady = options.onReady;
    this.probeIntervalMs = options.probeIntervalMs ?? RENDERER_READY_PROBE_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? RENDERER_READY_TIMEOUT_MS;
  }

  get currentState(): RendererStartupState {
    return this.state;
  }

  beginLoad(): void {
    this.clearTimers();
    this.active = true;
    this.pageDidLoad = false;
    this.transitionTo('loading');
    this.timeoutTimer = setTimeout(() => {
      if (!this.active || this.state !== 'loading') return;
      this.clearTimers();
      this.transitionTo('failed');
    }, this.timeoutMs);
  }

  pageLoaded(): void {
    if (!this.active) this.beginLoad();
    if (this.pageDidLoad || this.state !== 'loading') return;
    this.pageDidLoad = true;
    this.probe();
    if (!this.active || this.state !== 'loading') return;
    this.probeTimer = setInterval(() => this.probe(), this.probeIntervalMs);
  }

  rendererReady(): void {
    if (!this.active || !this.pageDidLoad || this.state !== 'loading') return;
    this.clearTimers();
    this.transitionTo('ready');
    this.onReady();
  }

  retry(): void {
    this.beginLoad();
  }

  stop(): void {
    this.active = false;
    this.pageDidLoad = false;
    this.clearTimers();
  }

  private probe(): void {
    if (!this.active || !this.pageDidLoad || this.state !== 'loading') return;
    this.sendProbe();
  }

  private transitionTo(next: RendererStartupState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange(next);
  }

  private clearTimers(): void {
    if (this.probeTimer !== null) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}
