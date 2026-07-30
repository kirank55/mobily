interface AutomaticTerminalSizeOwnershipDependencies {
  claim(): void;
  release(): void;
  sendResize(cols: number, rows: number): void;
}

/**
 * Coordinates the terminal screen, the Station's ownership grant, and the
 * WebView's readable-grid proposals.
 */
export class AutomaticTerminalSizeOwnership {
  private connected = false;
  private ownedByRequester = false;
  private viewReady = false;
  private disposed = false;
  private viewOwnershipListener: ((owned: boolean) => void) | undefined;

  constructor(private readonly dependencies: AutomaticTerminalSizeOwnershipDependencies) {}

  subscribeViewOwnership(listener: (owned: boolean) => void): () => void {
    if (this.disposed) return () => {};
    this.viewOwnershipListener = listener;
    if (this.viewReady) listener(this.connected && this.ownedByRequester);
    return () => {
      if (this.viewOwnershipListener === listener) this.viewOwnershipListener = undefined;
    };
  }

  setConnected(connected: boolean): void {
    if (this.disposed || connected === this.connected) return;
    this.connected = connected;
    if (connected) {
      this.dependencies.claim();
      return;
    }
    this.ownedByRequester = false;
    if (this.viewReady) this.viewOwnershipListener?.(false);
  }

  setViewReady(): void {
    if (this.disposed) return;
    this.viewReady = true;
    this.viewOwnershipListener?.(this.connected && this.ownedByRequester);
  }

  setOwnedByRequester(owned: boolean): void {
    if (this.disposed) return;
    this.ownedByRequester = this.connected && owned;
    if (this.viewReady) this.viewOwnershipListener?.(this.ownedByRequester);
  }

  proposeGrid(cols: number, rows: number): void {
    if (!this.disposed && this.connected && this.ownedByRequester) {
      this.dependencies.sendResize(cols, rows);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.connected) this.dependencies.release();
    this.connected = false;
    this.ownedByRequester = false;
    if (this.viewReady) this.viewOwnershipListener?.(false);
    this.viewOwnershipListener = undefined;
  }
}
