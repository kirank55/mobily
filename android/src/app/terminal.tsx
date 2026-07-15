/**
 * src/app/terminal.tsx
 *
 * Terminal route — connects the WS client and renders the xterm.js WebView.
 *
 * Connection state machine:
 *   disconnected → connecting → connected → reconnecting → failed
 *
 * Error UX:
 *   auth-rejection   → "Device not recognized — scan QR to re-pair"
 *   station-offline  → "Station unreachable — is the CLI running?"
 *   version-mismatch → "Please update the app or the CLI"
 *   network-change   → auto-reconnect
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { loadPairing, clearPairing } from '@/auth/storage';
import { useStationConnection } from '@/client/StationConnection';
import TerminalView, { type TerminalViewHandle } from '@/terminal/TerminalView';

export default function TerminalRoute() {
  const {
    state: connState,
    detail,
    errorKind,
    pairing,
    connect,
    disconnect,
    retry,
    sendInput,
    sendResize,
    subscribeOutput,
  } = useStationConnection();
  const stationName = pairing?.stationName ?? 'Station';
  const [termReady, setTermReady] = useState(false);
  const [latencyStats, setLatencyStats] = useState<{ n: number; p50: number; p95: number } | null>(
    null,
  );

  const termRef = useRef<TerminalViewHandle | null>(null);

  const handleReScan = useCallback(() => {
    disconnect();
    void clearPairing();
    router.replace('/scanner');
  }, [disconnect]);

  const handleRetry = useCallback(() => {
    retry();
  }, [retry]);

  // ── Connect on mount ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const record = await loadPairing();
      if (record && !cancelled) connect(record);
    })();
    return () => {
      cancelled = true;
    };
  }, [connect]);

  // ── App resume → reconnect if dropped ──────────────────────────────────
  useEffect(() => {
    return subscribeOutput((data, latencyTags) => {
      termRef.current?.write(data, latencyTags);
    });
  }, [subscribeOutput]);

  // ── Terminal resize → send to WS ────────────────────────────────────────
  const handleTermResize = useCallback((cols: number, rows: number) => {
    sendResize(cols, rows);
  }, [sendResize]);

  // ── Terminal input → send to WS ─────────────────────────────────────────
  const handleTermInput = useCallback((data: string, latencyTag: string) => {
    sendInput(data, latencyTag);
  }, [sendInput]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (connState === 'failed') {
    const isAuthRejection = errorKind === 'auth-rejection';
    const isVersionMismatch = errorKind === 'version-mismatch';
    const isBiometric = errorKind === 'biometric-cancelled';

    const headline = isAuthRejection
      ? 'Device not recognized'
      : isVersionMismatch
        ? 'Please update'
        : isBiometric
          ? 'Authentication cancelled'
          : 'Connection lost';

    const subtext = isAuthRejection
      ? 'Scan QR to re-pair your device'
      : isVersionMismatch
        ? 'Update the app or the CLI to the same version'
        : isBiometric
          ? 'Biometric authentication was cancelled. Tap Retry to try again.'
          : detail || 'Is the CLI running on your Station?';

    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.errorHeadline}>{headline}</Text>
          <Text style={styles.errorDetail}>{subtext}</Text>
          {!isAuthRejection && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleRetry}
              accessibilityLabel="Retry connection"
            >
              <Text style={styles.primaryBtnText}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleReScan}
            accessibilityLabel="Re-scan QR code"
          >
            <Text style={styles.secondaryBtnText}>Re-scan QR</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View
          style={[
            styles.dot,
            connState === 'connected'
              ? styles.dotConnected
              : connState === 'reconnecting'
                ? styles.dotReconnecting
                : styles.dotConnecting,
          ]}
        />
        <Text style={styles.statusText}>
          {connState === 'connected'
            ? stationName
            : connState === 'reconnecting'
              ? `Reconnecting… ${detail}`
              : `Connecting to ${stationName}…`}
        </Text>
        <TouchableOpacity onPress={() => router.push('/git' as never)} accessibilityLabel="Open Git">
          <Text style={styles.navLink}>Git</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/hosts' as never)} accessibilityLabel="Open Stations">
          <Text style={styles.navLink}>Stations</Text>
        </TouchableOpacity>
        {latencyStats && (
          <Text style={styles.latencyText} accessibilityLabel="Terminal latency">
            P50 {latencyStats.p50}ms · P95 {latencyStats.p95}ms
          </Text>
        )}
      </View>

      {/* Terminal WebView (always mounted; overlay shown on top when not connected) */}
      <View style={styles.terminalWrapper}>
        <TerminalView
          ref={termRef}
          onReady={() => setTermReady(true)}
          onInput={handleTermInput}
          onResize={handleTermResize}
          onLatencyStats={(n, p50, p95) => {
            console.log(`[mobily latency] n=${n} P50=${p50}ms P95=${p95}ms`);
            setLatencyStats({ n, p50, p95 });
          }}
        />
        {/* Connecting / Reconnecting overlay */}
        {(connState === 'connecting' || connState === 'reconnecting' || !termReady) && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#58a6ff" />
            <Text style={styles.overlayText}>
              {connState === 'reconnecting'
                ? `Reconnecting… (${detail})`
                : `Connecting to ${stationName}…`}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#0d1117',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: '#2ea043',
  },
  dotReconnecting: {
    backgroundColor: '#e3b341',
  },
  dotConnecting: {
    backgroundColor: '#484f58',
  },
  statusText: {
    color: '#8b949e',
    fontSize: 13,
    flex: 1,
  },
  latencyText: {
    color: '#6e7681',
    fontSize: 11,
  },
  navLink: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '600',
  },
  terminalWrapper: {
    flex: 1,
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(13,17,23,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    zIndex: 10,
  },
  overlayText: {
    color: '#8b949e',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  errorHeadline: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f85149',
    textAlign: 'center',
  },
  errorDetail: {
    fontSize: 14,
    color: '#8b949e',
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: '#238636',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    marginTop: 4,
  },
  secondaryBtnText: {
    color: '#58a6ff',
    fontSize: 15,
  },
});
