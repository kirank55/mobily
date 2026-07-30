import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { PROTOCOL_VERSION, type SessionSnapshotFrame } from '@mobily/shared';
import type { PairingRecord } from '@/auth/storage';
import { markConnected } from '@/auth/storage';
import { WsClient, type ConnectionState, type ErrorKind } from './wsClient';
import { RpcClient } from './rpcClient';
import { ForegroundConnectionController } from '@/foreground/controller';
import { SessionSnapshotChannel } from './sessionSnapshotChannel';

type OutputListener = (data: string, latencyTags?: readonly string[]) => void;
type ResizeListener = (cols: number, rows: number) => void;
type SnapshotListener = (snapshot: SessionSnapshotFrame) => void;
type ScrollbackListener = (data: string) => void;
type TerminalSizeOwnerListener = (ownedByRequester: boolean) => void;

interface StationConnectionValue {
  pairing: PairingRecord | null;
  state: ConnectionState;
  detail: string;
  errorKind: ErrorKind;
  rpc: RpcClient | null;
  connect(pairing: PairingRecord): void;
  disconnect(): void;
  retry(): void;
  sendInput(data: string, latencyTag?: string): void;
  sendResize(cols: number, rows: number): void;
  claimTerminalSize(): void;
  releaseTerminalSize(): void;
  acknowledgeSnapshotApplied(): void;
  subscribeOutput(listener: OutputListener): () => void;
  subscribeResize(listener: ResizeListener): () => void;
  subscribeSnapshot(listener: SnapshotListener): () => void;
  subscribeScrollback(listener: ScrollbackListener): () => void;
  subscribeTerminalSizeOwner(listener: TerminalSizeOwnerListener): () => void;
}

const StationConnectionContext = createContext<StationConnectionValue | null>(null);

export function StationConnectionProvider({ children }: PropsWithChildren) {
  const [pairing, setPairing] = useState<PairingRecord | null>(null);
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [detail, setDetail] = useState('');
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic');
  const [rpc, setRpc] = useState<RpcClient | null>(null);
  const clientRef = useRef<WsClient | null>(null);
  const rpcRef = useRef<RpcClient | null>(null);
  const pairingRef = useRef<PairingRecord | null>(null);
  const outputListeners = useRef(new Set<OutputListener>());
  const resizeListeners = useRef(new Set<ResizeListener>());
  const scrollbackListeners = useRef(new Set<ScrollbackListener>());
  const terminalSizeOwnerListeners = useRef(new Set<TerminalSizeOwnerListener>());
  const latestResize = useRef<{ cols: number; rows: number } | null>(null);
  const latestTerminalSizeOwner = useRef(false);
  const foreground = useRef(new ForegroundConnectionController());
  const [snapshotChannel] = useState(() => new SessionSnapshotChannel());

  const disconnect = useCallback(() => {
    rpcRef.current?.disconnect();
    clientRef.current?.disconnect();
    clientRef.current = null;
    rpcRef.current = null;
    pairingRef.current = null;
    latestResize.current = null;
    latestTerminalSizeOwner.current = false;
    snapshotChannel.reset();
    setRpc(null);
    setPairing(null);
    setState('disconnected');
    void foreground.current.disconnect();
  }, [snapshotChannel]);

  const connect = useCallback(
    (nextPairing: PairingRecord) => {
      if (
        pairingRef.current?.deviceBindingId === nextPairing.deviceBindingId &&
        clientRef.current &&
        clientRef.current.currentState !== 'failed'
      ) {
        return;
      }

      rpcRef.current?.disconnect();
      clientRef.current?.disconnect();
      latestResize.current = null;
      latestTerminalSizeOwner.current = false;
      snapshotChannel.reset();
      let client!: WsClient;
      const nextRpc = new RpcClient((frame) => client.sendRpc(frame));
      client = new WsClient({
        url: nextPairing.tunnelUrl,
        deviceBindingId: nextPairing.deviceBindingId,
        keyAlias: nextPairing.keyAlias,
        certificatePin: nextPairing.certificatePin,
        protocolVersion: PROTOCOL_VERSION,
        onStateChange: (nextState, nextDetail) => {
          setState(nextState);
          setDetail(nextDetail ?? '');
          if (
            nextState === 'reconnecting' ||
            nextState === 'failed' ||
            nextState === 'disconnected'
          ) {
            nextRpc.disconnect();
          }
          if (nextState === 'failed' || nextState === 'disconnected') {
            void foreground.current.disconnect();
          } else {
            void foreground.current.updateState(nextState);
          }
        },
        onOutput: (data, latencyTags) => {
          for (const listener of outputListeners.current) listener(data, latencyTags);
        },
        onResize: (cols, rows) => {
          latestResize.current = { cols, rows };
          for (const listener of resizeListeners.current) listener(cols, rows);
        },
        onSnapshot: (snapshot) => {
          snapshotChannel.publish(snapshot);
        },
        onScrollback: (data) => {
          for (const listener of scrollbackListeners.current) listener(data);
        },
        onTerminalSizeOwner: ({ ownedByRequester }) => {
          latestTerminalSizeOwner.current = ownedByRequester;
          for (const listener of terminalSizeOwnerListeners.current) {
            listener(ownedByRequester);
          }
        },
        onAlert: (message) => void foreground.current.alert(message),
        onSessionStatus: (phase, detail) => void foreground.current.updatePhase(phase, detail),
        onRpcFrame: (frame) => nextRpc.handleFrame(frame),
        onReady: () => {
          void markConnected(nextPairing.deviceBindingId).catch((error) => {
            console.warn('[Mobily][Connection] Failed to update last-connected metadata', error);
          });
        },
        onError: (message, kind) => {
          setDetail(message);
          setErrorKind(kind ?? 'generic');
        },
      });
      pairingRef.current = nextPairing;
      clientRef.current = client;
      rpcRef.current = nextRpc;
      setPairing(nextPairing);
      setRpc(nextRpc);
      setErrorKind('generic');
      void foreground.current.connect(nextPairing.stationName);
      client.connect();
    },
    [snapshotChannel],
  );

  const retry = useCallback(() => {
    if (pairingRef.current) void foreground.current.connect(pairingRef.current.stationName);
    clientRef.current?.connect();
  }, []);
  const sendInput = useCallback((data: string, latencyTag?: string) => {
    clientRef.current?.sendInput(data, latencyTag);
  }, []);
  const sendResize = useCallback((cols: number, rows: number) => {
    clientRef.current?.sendResize(cols, rows);
  }, []);
  const claimTerminalSize = useCallback(() => {
    clientRef.current?.claimTerminalSize();
  }, []);
  const releaseTerminalSize = useCallback(() => {
    clientRef.current?.releaseTerminalSize();
  }, []);
  const acknowledgeSnapshotApplied = useCallback(() => {
    clientRef.current?.acknowledgeSnapshotApplied();
  }, []);
  const subscribeOutput = useCallback((listener: OutputListener) => {
    outputListeners.current.add(listener);
    return () => outputListeners.current.delete(listener);
  }, []);
  const subscribeResize = useCallback((listener: ResizeListener) => {
    resizeListeners.current.add(listener);
    const current = latestResize.current;
    if (current) listener(current.cols, current.rows);
    return () => resizeListeners.current.delete(listener);
  }, []);
  const subscribeSnapshot = useCallback(
    (listener: SnapshotListener) => snapshotChannel.subscribe(listener),
    [snapshotChannel],
  );
  const subscribeScrollback = useCallback((listener: ScrollbackListener) => {
    scrollbackListeners.current.add(listener);
    return () => scrollbackListeners.current.delete(listener);
  }, []);
  const subscribeTerminalSizeOwner = useCallback((listener: TerminalSizeOwnerListener) => {
    terminalSizeOwnerListeners.current.add(listener);
    listener(latestTerminalSizeOwner.current);
    return () => terminalSizeOwnerListeners.current.delete(listener);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active' || !clientRef.current) return;
      const current = clientRef.current.currentState;
      if (
        current === 'disconnected' ||
        (current === 'failed' && errorKind !== 'auth-rejection' && errorKind !== 'device-key-error')
      ) {
        if (pairingRef.current) void foreground.current.connect(pairingRef.current.stationName);
        clientRef.current.connect();
      }
    });
    return () => subscription.remove();
  }, [errorKind]);

  useEffect(() => () => disconnect(), [disconnect]);

  const value = useMemo<StationConnectionValue>(
    () => ({
      pairing,
      state,
      detail,
      errorKind,
      rpc,
      connect,
      disconnect,
      retry,
      sendInput,
      sendResize,
      claimTerminalSize,
      releaseTerminalSize,
      acknowledgeSnapshotApplied,
      subscribeOutput,
      subscribeResize,
      subscribeSnapshot,
      subscribeScrollback,
      subscribeTerminalSizeOwner,
    }),
    [
      pairing,
      state,
      detail,
      errorKind,
      rpc,
      connect,
      disconnect,
      retry,
      sendInput,
      sendResize,
      claimTerminalSize,
      releaseTerminalSize,
      acknowledgeSnapshotApplied,
      subscribeOutput,
      subscribeResize,
      subscribeSnapshot,
      subscribeScrollback,
      subscribeTerminalSizeOwner,
    ],
  );
  return (
    <StationConnectionContext.Provider value={value}>{children}</StationConnectionContext.Provider>
  );
}

export function useStationConnection(): StationConnectionValue {
  const value = useContext(StationConnectionContext);
  if (!value) throw new Error('useStationConnection must be used inside its provider');
  return value;
}
