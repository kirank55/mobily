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
import { PROTOCOL_VERSION } from '@mobily/shared';
import type { PairingRecord } from '@/auth/storage';
import { markConnected } from '@/auth/storage';
import { WsClient, type ConnectionState, type ErrorKind } from './wsClient';
import { RpcClient } from './rpcClient';

type OutputListener = (data: string, latencyTags?: readonly string[]) => void;

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
  subscribeOutput(listener: OutputListener): () => void;
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

  const disconnect = useCallback(() => {
    rpcRef.current?.disconnect();
    clientRef.current?.disconnect();
    clientRef.current = null;
    rpcRef.current = null;
    pairingRef.current = null;
    setRpc(null);
    setPairing(null);
    setState('disconnected');
  }, []);

  const connect = useCallback((nextPairing: PairingRecord) => {
    if (
      pairingRef.current?.deviceBindingId === nextPairing.deviceBindingId &&
      clientRef.current &&
      clientRef.current.currentState !== 'failed'
    ) {
      return;
    }

    rpcRef.current?.disconnect();
    clientRef.current?.disconnect();
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
        if (nextState === 'reconnecting' || nextState === 'failed' || nextState === 'disconnected') {
          nextRpc.disconnect();
        }
      },
      onOutput: (data, latencyTags) => {
        for (const listener of outputListeners.current) listener(data, latencyTags);
      },
      onRpcFrame: (frame) => nextRpc.handleFrame(frame),
      onReady: () => {
        void markConnected(nextPairing.deviceBindingId);
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
    client.connect();
  }, []);

  const retry = useCallback(() => clientRef.current?.connect(), []);
  const sendInput = useCallback((data: string, latencyTag?: string) => {
    clientRef.current?.sendInput(data, latencyTag);
  }, []);
  const sendResize = useCallback((cols: number, rows: number) => {
    clientRef.current?.sendResize(cols, rows);
  }, []);
  const subscribeOutput = useCallback((listener: OutputListener) => {
    outputListeners.current.add(listener);
    return () => outputListeners.current.delete(listener);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active' || !clientRef.current) return;
      const current = clientRef.current.currentState;
      if (current === 'disconnected' || (current === 'failed' && errorKind !== 'auth-rejection')) {
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
      subscribeOutput,
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
      subscribeOutput,
    ],
  );
  return (
    <StationConnectionContext.Provider value={value}>
      {children}
    </StationConnectionContext.Provider>
  );
}

export function useStationConnection(): StationConnectionValue {
  const value = useContext(StationConnectionContext);
  if (!value) throw new Error('useStationConnection must be used inside its provider');
  return value;
}
