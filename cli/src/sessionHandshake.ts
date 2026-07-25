import type { RawData, WebSocket } from 'ws';
import { decodeFrame, PROTOCOL_VERSION, WS_CLOSE_CODES, type Frame } from '@mobily/shared';
import type { AuthManager } from './auth.js';
import { rawToUtf8 } from './sessionUtils.js';

export interface SessionHandshakeHost {
  readonly auth: AuthManager;
  readonly handshakeTimeoutMs: number;
  sendTo(ws: WebSocket, frame: Frame): void;
  attachAuthenticated(ws: WebSocket): void;
}

export class SessionHandshake {
  constructor(private readonly host: SessionHandshakeHost) {}

  startHandshake(ws: WebSocket): void {
    const timeout = setTimeout(() => {
      ws.close(WS_CLOSE_CODES.HANDSHAKE_TIMEOUT, 'handshake timeout');
    }, this.host.handshakeTimeoutMs);
    const clearHandshakeTimeout = (): void => clearTimeout(timeout);
    ws.once('close', clearHandshakeTimeout);
    ws.once('error', clearHandshakeTimeout);

    const onMessage = (data: RawData): void => {
      let frame: Frame;
      try {
        frame = decodeFrame(rawToUtf8(data));
      } catch {
        this.host.sendTo(ws, {
          type: 'output',
          data: 'mobily: malformed frame\r\n',
        });
        ws.close(WS_CLOSE_CODES.MALFORMED_FRAME, 'malformed frame');
        return;
      }

      if (frame.type !== 'hello') {
        this.host.sendTo(ws, {
          type: 'output',
          data: 'mobily: expected hello frame first\r\n',
        });
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'protocol error');
        return;
      }

      ws.off('message', onMessage);
      this.handleHello(ws, frame.protocolVersion, clearHandshakeTimeout);
    };

    ws.on('message', onMessage);
    ws.on('close', () => ws.off('message', onMessage));
    ws.on('error', () => ws.off('message', onMessage));
  }

  private handleHello(
    ws: WebSocket,
    clientVersion: number,
    clearHandshakeTimeout: () => void,
  ): void {
    if (clientVersion !== PROTOCOL_VERSION) {
      this.host.sendTo(ws, {
        type: 'output',
        data:
          `mobily: protocol version mismatch ` +
          `(client ${clientVersion}, server ${PROTOCOL_VERSION}). ` +
          `Please update.\r\n`,
      });
      ws.close(WS_CLOSE_CODES.VERSION_MISMATCH, 'version mismatch');
      return;
    }

    this.host.sendTo(ws, { type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    this.startAuthChallenge(ws, clearHandshakeTimeout);
  }

  private startAuthChallenge(ws: WebSocket, clearHandshakeTimeout: () => void): void {
    const nonce = this.host.auth.createChallenge();
    this.host.sendTo(ws, { type: 'auth-challenge', nonce });

    const onMessage = (data: RawData): void => {
      let frame: Frame;
      try {
        frame = decodeFrame(rawToUtf8(data));
      } catch {
        this.host.sendTo(ws, {
          type: 'output',
          data: 'mobily: malformed frame\r\n',
        });
        ws.close(WS_CLOSE_CODES.MALFORMED_FRAME, 'malformed frame');
        return;
      }

      if (frame.type !== 'auth-response') {
        this.host.sendTo(ws, {
          type: 'output',
          data: 'mobily: expected auth-response frame\r\n',
        });
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'protocol error');
        return;
      }

      ws.off('message', onMessage);

      const verified = this.host.auth.verifyResponse(frame.deviceId, nonce, frame.signature);

      if (!verified) {
        this.host.sendTo(ws, {
          type: 'output',
          data: 'mobily: authentication failed — device not recognized. Scan QR to re-pair.\r\n',
        });
        ws.close(WS_CLOSE_CODES.AUTH_REJECTED, 'auth failed');
        return;
      }

      clearHandshakeTimeout();
      this.host.sendTo(ws, { type: 'auth-ok' });
      this.host.attachAuthenticated(ws);
    };

    ws.on('message', onMessage);
    ws.on('close', () => ws.off('message', onMessage));
    ws.on('error', () => ws.off('message', onMessage));
  }
}
