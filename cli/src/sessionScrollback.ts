import type { WebSocket } from 'ws';
import {
  MAX_SESSION_SCROLLBACK_CHUNK_CHARS,
  WS_CLOSE_CODES,
  type Frame,
} from '@mobily/shared';

export interface SessionScrollbackHost {
  sendTo(ws: WebSocket, frame: Frame): void;
  getPendingScrollback(ws: WebSocket): string | undefined;
  deletePendingScrollback(ws: WebSocket): void;
  nextTransferId(): string;
}

export class SessionScrollback {
  constructor(private readonly host: SessionScrollbackHost) {}

  sendPendingScrollback(ws: WebSocket): void {
    const history = this.host.getPendingScrollback(ws);
    if (history === undefined) {
      ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Session Snapshot acknowledgement');
      return;
    }
    this.host.deletePendingScrollback(ws);
    const transferId = this.host.nextTransferId();
    if (history.length === 0) {
      this.host.sendTo(ws, {
        type: 'session-scrollback',
        transferId,
        sequence: 0,
        data: '',
        done: true,
      });
      return;
    }
    let sequence = 0;
    for (let offset = 0; offset < history.length; offset += MAX_SESSION_SCROLLBACK_CHUNK_CHARS) {
      const data = history.slice(offset, offset + MAX_SESSION_SCROLLBACK_CHUNK_CHARS);
      this.host.sendTo(ws, {
        type: 'session-scrollback',
        transferId,
        sequence: sequence++,
        data,
        done: offset + data.length >= history.length,
      });
    }
  }
}
