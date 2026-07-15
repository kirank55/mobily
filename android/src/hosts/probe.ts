import type { PairingRecord } from '@/auth/storage';
import { PinnedWebSocket } from '@/client/pinnedTransport';

interface ProbeSocket {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(code?: number, reason?: string): void;
}

/** Checks endpoint reachability without sending hello or prompting for a Device Key. */
export function probeStation(pairing: PairingRecord, timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: ProbeSocket;
    const finish = (online: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close(1000, 'reachability probe complete');
      } catch {
        // The endpoint already closed.
      }
      resolve(online);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      socket = (pairing.certificatePin
        ? new PinnedWebSocket(pairing.tunnelUrl, pairing.certificatePin)
        : new WebSocket(pairing.tunnelUrl)) as unknown as ProbeSocket;
      socket.onopen = () => finish(true);
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}
