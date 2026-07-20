export interface TerminalSizeOwnershipActions {
  claim(): void;
  release(): void;
}

export interface TerminalSizeOwnershipOptions {
  releaseDebounceMs?: number;
  leaseRefreshMs?: number;
}

/**
 * Turns connection, navigation, and AppState signals into one debounced
 * Terminal Size Ownership lifecycle.
 */
export class TerminalSizeOwnershipController {
  private readonly releaseDebounceMs: number;
  private readonly leaseRefreshMs: number;
  private connected = false;
  private terminalVisible = false;
  private appActive = false;
  private claimed = false;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    private actions: TerminalSizeOwnershipActions,
    options: TerminalSizeOwnershipOptions = {},
  ) {
    this.releaseDebounceMs = options.releaseDebounceMs ?? 250;
    this.leaseRefreshMs = options.leaseRefreshMs ?? 5_000;
  }

  setActions(actions: TerminalSizeOwnershipActions): void {
    this.actions = actions;
  }

  setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    if (!connected) {
      this.cancelRelease();
      this.stopRefresh();
      this.claimed = false;
      return;
    }
    this.reconcile();
  }

  setTerminalVisible(visible: boolean): void {
    if (this.terminalVisible === visible) return;
    this.terminalVisible = visible;
    this.reconcile();
  }

  setAppActive(active: boolean): void {
    if (this.appActive === active) return;
    this.appActive = active;
    this.reconcile();
  }

  private reconcile(): void {
    if (this.connected && this.terminalVisible && this.appActive) {
      this.cancelRelease();
      if (!this.claimed) {
        this.actions.claim();
        this.claimed = true;
      }
      this.startRefresh();
      return;
    }
    this.stopRefresh();
    if (!this.connected || !this.claimed || this.releaseTimer) return;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = undefined;
      if (!this.connected || !this.claimed || (this.terminalVisible && this.appActive)) return;
      this.actions.release();
      this.claimed = false;
    }, this.releaseDebounceMs);
  }

  private startRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      if (this.connected && this.claimed && this.terminalVisible && this.appActive) {
        this.actions.claim();
      }
    }, this.leaseRefreshMs);
  }

  private stopRefresh(): void {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private cancelRelease(): void {
    if (!this.releaseTimer) return;
    clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
  }
}
