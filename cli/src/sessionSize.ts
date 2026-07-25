import type { WebSocket } from 'ws';
import type { AlertFrame, OutputFrame, ResizeFrame, SessionStatusFrame } from '@mobily/shared';
import { errorText } from './sessionUtils.js';

export interface SizeClaimant {
  readonly sequence: number;
  leaseTimer?: ReturnType<typeof setTimeout>;
}

export interface SessionSizeHost {
  readonly ownershipLeaseMs: number;
  get sizeOwner(): WebSocket | undefined;
  set sizeOwner(value: WebSocket | undefined);
  readonly sizeClaimants: Map<WebSocket, SizeClaimant>;
  nextClaimSequence(): number;
  get currentCols(): number;
  get currentRows(): number;
  get stationCols(): number;
  get stationRows(): number;
  sendTo(
    ws: WebSocket,
    frame: {
      type: 'terminal-size-owner';
      owner: 'android' | 'station';
      ownedByRequester: boolean;
    },
  ): void;
  broadcast(
    frame: OutputFrame | AlertFrame | SessionStatusFrame | ResizeFrame,
  ): void;
  applyResize(cols: number, rows: number): void;
  forEachViewer(callback: (ws: WebSocket) => void): void;
}

export class SessionSizeOwnership {
  constructor(private readonly host: SessionSizeHost) {}

  claimSizeOwnership(ws: WebSocket): void {
    const existing = this.host.sizeClaimants.get(ws);
    if (existing) {
      this.renewSizeOwnershipLease(ws, existing);
      return;
    }
    const claimant: SizeClaimant = {
      sequence: this.host.nextClaimSequence(),
    };
    this.host.sizeClaimants.set(ws, claimant);
    this.host.sizeOwner = ws;
    this.renewSizeOwnershipLease(ws, claimant);
    this.broadcastSizeOwnershipState();
  }

  renewSizeOwnershipLease(ws: WebSocket, claimant = this.host.sizeClaimants.get(ws)): void {
    if (!claimant) return;
    clearTimeout(claimant.leaseTimer);
    claimant.leaseTimer = setTimeout(() => this.releaseSizeClaim(ws), this.host.ownershipLeaseMs);
    claimant.leaseTimer.unref?.();
  }

  releaseSizeClaim(ws: WebSocket): void {
    const claimant = this.host.sizeClaimants.get(ws);
    if (!claimant) return;
    clearTimeout(claimant.leaseTimer);
    this.host.sizeClaimants.delete(ws);
    if (this.host.sizeOwner !== ws) return;

    this.host.sizeOwner = this.mostRecentSizeClaimant();
    if (this.host.sizeOwner) {
      this.broadcastSizeOwnershipState();
      return;
    }
    try {
      if (
        this.host.currentCols !== this.host.stationCols ||
        this.host.currentRows !== this.host.stationRows
      ) {
        this.host.applyResize(this.host.stationCols, this.host.stationRows);
      }
    } catch (error) {
      this.host.broadcast({
        type: 'output',
        data: `mobily: failed to restore Station dimensions — ${errorText(error)}\r\n`,
      });
    } finally {
      this.broadcastSizeOwnershipState();
    }
  }

  sendSizeOwnershipState(ws: WebSocket): void {
    this.host.sendTo(ws, {
      type: 'terminal-size-owner',
      owner: this.host.sizeOwner ? 'android' : 'station',
      ownedByRequester: this.host.sizeOwner === ws,
    });
  }

  broadcastSizeOwnershipState(): void {
    this.host.forEachViewer((viewer) => this.sendSizeOwnershipState(viewer));
  }

  clearSizeClaimants(): void {
    for (const claimant of this.host.sizeClaimants.values()) clearTimeout(claimant.leaseTimer);
    this.host.sizeClaimants.clear();
  }

  private mostRecentSizeClaimant(): WebSocket | undefined {
    let newest: { ws: WebSocket; sequence: number } | undefined;
    for (const [ws, claimant] of this.host.sizeClaimants) {
      if (!newest || claimant.sequence > newest.sequence) {
        newest = { ws, sequence: claimant.sequence };
      }
    }
    return newest?.ws;
  }
}
