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
import { TerminalSizeOwnershipController } from '@/terminal/sizeOwnership';

type OutputListener = (data: string, latencyTags?: readonly string[]) => void;
type ResizeListener = (cols: number, rows: number) => void;
type SnapshotListener = (snapshot: SessionSnapshotFrame) => void;
type ScrollbackListener = (data: string) => void;

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
  acknowledgeSnapshotApplied(): void;
  setTerminalVisible(visible: boolean): void;
  subscribeOutput(listener: OutputListener): () => void;
  subscribeResize(listener: ResizeListener): () => void;
  subscribeSnapshot(listener: SnapshotListener): () => void;
  subscribeScrollback(listener: ScrollbackListener): () => void;
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
  const snapshotListeners = useRef(new Set<SnapshotListener>());
  const scrollbackListeners = useRef(new Set<ScrollbackListener>());
  const latestResize = useRef<{ cols: number; rows: number } | null>(null);
  const foreground = useRef(new ForegroundConnectionController());
  const [sizeOwnership] = useState(
    () =>
      new TerminalSizeOwnershipController({
        claim() {},
        release() {},
      }),
  );

  useEffect(() => {
    sizeOwnership.setActions({
      claim: () => clientRef.current?.claimTerminalSize(),
      release: () => clientRef.current?.releaseTerminalSize(),
    });
  }, [sizeOwnership]);

  const disconnect = useCallback(() => {
    sizeOwnership.setConnected(false);
    rpcRef.current?.disconnect();
    clientRef.current?.disconnect();
    clientRef.current = null;
    rpcRef.current = null;
    pairingRef.current = null;
    latestResize.current = null;
    setRpc(null);
    setPairing(null);
    setState('disconnected');
    void foreground.current.disconnect();
  }, [sizeOwnership]);

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
      let client!: WsClient;
      const nextRpc = new RpcClient((frame) => client.sendRpc(frame));
      client = new WsClient({
        url: nextPairing.tunnelUrl,
        deviceBindingId: nextPairing.deviceBindingId,
        keyAlias: nextPairing.keyAlias,
        certificatePin: nextPairing.certificatePin,
        protocolVersion: PROTOCOL_VERSION,
        onStateChange: (nextState, nextDetail) => {
          sizeOwnership.setConnected(nextState === 'connected');
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
          foreground.current.recordOutput(data);
          for (const listener of outputListeners.current) listener(data, latencyTags);
        },
        onResize: (cols, rows) => {
          latestResize.current = { cols, rows };
          for (const listener of resizeListeners.current) listener(cols, rows);
        },
        onSnapshot: (snapshot) => {
          for (const listener of snapshotListeners.current) listener(snapshot);
        },
        onScrollback: (data) => {
          for (const listener of scrollbackListeners.current) listener(data);
        },
        onAlert: (message) => void foreground.current.alert(message),
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
    [sizeOwnership],
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
  const acknowledgeSnapshotApplied = useCallback(() => {
    clientRef.current?.acknowledgeSnapshotApplied();
  }, []);
  const setTerminalVisible = useCallback(
    (visible: boolean) => {
      sizeOwnership.setTerminalVisible(visible);
    },
    [sizeOwnership],
  );
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
  const subscribeSnapshot = useCallback((listener: SnapshotListener) => {
    snapshotListeners.current.add(listener);
    return () => snapshotListeners.current.delete(listener);
  }, []);
  const subscribeScrollback = useCallback((listener: ScrollbackListener) => {
    scrollbackListeners.current.add(listener);
    return () => scrollbackListeners.current.delete(listener);
  }, []);

  useEffect(() => {
    sizeOwnership.setAppActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      sizeOwnership.setAppActive(nextState === 'active');
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
  }, [errorKind, sizeOwnership]);

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
      acknowledgeSnapshotApplied,
      setTerminalVisible,
      subscribeOutput,
      subscribeResize,
      subscribeSnapshot,
      subscribeScrollback,
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
      acknowledgeSnapshotApplied,
      setTerminalVisible,
      subscribeOutput,
      subscribeResize,
      subscribeSnapshot,
      subscribeScrollback,
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
