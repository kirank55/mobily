/**
 * src/app/terminal.tsx
 *
 * Terminal route — connects the WS client and displays connection state.
 * The xterm.js WebView arrives in branch 4; for now this validates the
 * WS handshake + auth flow against the CLI.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { WsClient, type ConnectionState } from '@/client/wsClient';
import { loadPairing } from '@/auth/storage';
import { PROTOCOL_VERSION } from '@mobily/shared';
import { clearPairing } from '@/auth/storage';

export default function TerminalRoute() {
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [detail, setDetail] = useState('');
  const [outputLog, setOutputLog] = useState('');
  const clientRef = useRef<WsClient | null>(null);

  const handleReScan = useCallback(() => {
    clientRef.current?.disconnect();
    void clearPairing();
    router.replace('/scanner');
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const record = await loadPairing();
      if (!record || cancelled) return;

      const client = new WsClient({
        url: record.tunnelUrl,
        deviceId: record.deviceId,
        protocolVersion: PROTOCOL_VERSION,
        onStateChange: (state, d) => {
          if (cancelled) return;
          setConnState(state);
          setDetail(d ?? '');
        },
        onOutput: (data) => {
          if (cancelled) return;
          setOutputLog((prev) => (prev + data).slice(-2000));
        },
        onError: (msg) => {
          if (cancelled) return;
          setDetail(msg);
        },
      });

      clientRef.current = client;
      client.connect();
    })();

    return () => {
      cancelled = true;
      clientRef.current?.disconnect();
    };
  }, []);

  if (connState === 'failed') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.error}>Connection lost</Text>
          <Text style={styles.detail}>{detail}</Text>
          <TouchableOpacity style={styles.button} onPress={() => clientRef.current?.connect()}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonSecondary} onPress={handleReScan}>
            <Text style={styles.buttonSecondaryText}>Re-scan QR</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (connState === 'connected') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.statusBar}>
          <View style={[styles.dot, styles.dotConnected]} />
          <Text style={styles.statusText}>Connected</Text>
        </View>
        <Text style={styles.output} numberOfLines={20}>{outputLog || '(waiting for output…)'}</Text>
        <Text style={styles.hint}>Terminal WebView arrives in branch 4.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>
          {connState === 'reconnecting'
            ? `Reconnecting… ${detail}`
            : 'Connecting to Station…'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: '#2ea043',
  },
  statusText: {
    color: '#ccc',
    fontSize: 14,
  },
  message: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
  },
  error: {
    fontSize: 18,
    color: '#da3633',
    fontWeight: '600',
  },
  detail: {
    fontSize: 14,
    color: '#9a9a9a',
    textAlign: 'center',
  },
  output: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#e6e6e6',
    padding: 12,
  },
  hint: {
    fontSize: 12,
    color: '#555',
    padding: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2ea043',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondary: {
    marginTop: 8,
  },
  buttonSecondaryText: {
    color: '#58a6ff',
    fontSize: 14,
  },
});
