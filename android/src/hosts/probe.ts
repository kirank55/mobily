import type { PairingRecord } from '@/auth/storage';
import { PinnedWebSocket } from '@/client/pinnedTransport';

interface ProbeSocket {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(code?: number, reason?: string): void;
}

/** Checks endpoint reachability without sending hello or prompting for a Device Key. */
export function probeStation(
  pairing: PairingRecord,
  timeoutMs = 3_000,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    let socket: ProbeSocket | undefined;
    const finish = (online: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        socket?.close(1000, 'reachability probe complete');
      } catch {
        // The endpoint already closed.
      }
      resolve(online);
    };
    const abort = (): void => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
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
