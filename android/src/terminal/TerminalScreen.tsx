/**
 * src/terminal/TerminalScreen.tsx
 *
 * Terminal screen — connects the WS client and renders the xterm.js WebView.
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
import { Keyboard, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import type { SessionSnapshotFrame } from '@mobily/shared';

import { deleteKey } from '@/auth/deviceKey';
import { loadPairing, clearPairing } from '@/auth/storage';
import { useStationConnection } from '@/client/StationConnection';
import TerminalView, { type TerminalViewHandle } from '@/terminal/TerminalView';
import { loadTerminalFontSize, saveTerminalFontSize } from '@/terminal/fontPreference';
import { Button, Screen, Status } from '@/ui/components';
import { colors, fonts, minTouchTarget, spacing, type } from '@/ui/theme';

export default function TerminalScreen() {
  const {
    state: connState,
    detail,
    errorKind,
    pairing,
    connect,
    disconnect,
    retry,
    sendInput,
    acknowledgeSnapshotApplied,
    subscribeOutput,
    subscribeResize,
    subscribeSnapshot,
    subscribeScrollback,
  } = useStationConnection();
  const stationName = pairing?.stationName ?? 'Station';
  const [termReady, setTermReady] = useState(false);
  const [snapshotApplied, setSnapshotApplied] = useState(false);
  const [latencyStats, setLatencyStats] = useState<{ n: number; p50: number; p95: number } | null>(
    null,
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [fontSize, setFontSize] = useState<number | null>(null);
  const sessionSize = useRef({ cols: 120, rows: 40 });
  const pendingSnapshot = useRef<SessionSnapshotFrame | null>(null);
  const liveOutputSinceSnapshot = useRef<string[]>([]);
  const awaitingScrollback = useRef(false);

  const termRef = useRef<TerminalViewHandle | null>(null);

  const handleReScan = useCallback(() => {
    disconnect();
    void (async () => {
      try {
        const removed = await clearPairing();
        if (removed) await deleteKey(removed.keyAlias);
      } catch (error) {
        console.warn('Failed to clear the selected pairing', error);
      } finally {
        router.replace('/scanner');
      }
    })();
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

  useEffect(() => {
    let cancelled = false;
    void loadTerminalFontSize().then((size) => {
      if (!cancelled) setFontSize(size);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (!termReady || fontSize == null) return;
    termRef.current?.setFontSize(fontSize);
  }, [termReady, fontSize]);

  useEffect(() => {
    if (!termReady) return;
    // Station owns the Session grid; Android only scales the desktop view.
    termRef.current?.setSizeOwnership(false);
  }, [termReady]);

  // ── App resume → reconnect if dropped ──────────────────────────────────
  useEffect(() => {
    return subscribeOutput((data, latencyTags) => {
      if (awaitingScrollback.current) liveOutputSinceSnapshot.current.push(data);
      termRef.current?.write(data, latencyTags);
    });
  }, [subscribeOutput]);

  useEffect(() => {
    return subscribeResize((cols, rows) => {
      sessionSize.current = { cols, rows };
      termRef.current?.resize(cols, rows);
    });
  }, [subscribeResize]);

  useEffect(() => {
    return subscribeSnapshot((snapshot) => {
      pendingSnapshot.current = snapshot;
      liveOutputSinceSnapshot.current = [];
      awaitingScrollback.current = true;
      setSnapshotApplied(false);
      if (termReady) termRef.current?.applySnapshot(snapshot);
    });
  }, [subscribeSnapshot, termReady]);

  useEffect(() => {
    return subscribeScrollback((data) => {
      const snapshot = pendingSnapshot.current;
      if (snapshot) {
        const liveOutput = liveOutputSinceSnapshot.current.join('');
        liveOutputSinceSnapshot.current = [];
        awaitingScrollback.current = false;
        termRef.current?.applyScrollback(data, snapshot, liveOutput);
      }
    });
  }, [subscribeScrollback]);

  useEffect(() => {
    if (connState === 'connected' && snapshotApplied) {
      termRef.current?.setConnectionState('live');
    } else if (connState === 'connecting' || connState === 'reconnecting') {
      termRef.current?.setConnectionState(
        connState === 'reconnecting' ? 'reconnecting' : 'loading',
        detail,
      );
    }
  }, [connState, detail, snapshotApplied]);

  // ── Terminal resize → send to WS ────────────────────────────────────────
  const handleTerminalReady = useCallback(() => {
    setTermReady(true);
    termRef.current?.setConnectionState(
      connState === 'reconnecting' ? 'reconnecting' : 'loading',
      detail,
    );
    const snapshot = pendingSnapshot.current;
    if (snapshot) termRef.current?.applySnapshot(snapshot);
    else termRef.current?.resize(sessionSize.current.cols, sessionSize.current.rows);
  }, [connState, detail]);

  const handleSnapshotApplied = useCallback(() => {
    setSnapshotApplied(true);
    acknowledgeSnapshotApplied();
  }, [acknowledgeSnapshotApplied]);

  const handleFontSize = useCallback((next: number) => {
    setFontSize(next);
    void saveTerminalFontSize(next).catch((error) => {
      console.warn('[Mobily][Terminal] Failed to persist font size', error);
    });
  }, []);

  const toggleSelection = useCallback(() => {
    setSelectionMode((enabled) => {
      termRef.current?.setSelectionMode(!enabled);
      return !enabled;
    });
  }, []);

  const pasteClipboard = useCallback(() => {
    void Clipboard.getStringAsync().then((data) => {
      if (data) termRef.current?.paste(data);
    });
  }, []);

  const toggleKeyboard = useCallback(() => {
    if (keyboardVisible) {
      termRef.current?.hideKeyboard();
      Keyboard.dismiss();
    } else {
      termRef.current?.showKeyboard();
    }
  }, [keyboardVisible]);

  // ── Terminal input → send to WS ─────────────────────────────────────────
  const handleTermInput = useCallback(
    (data: string, latencyTag: string) => {
      sendInput(data, latencyTag);
    },
    [sendInput],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (connState === 'failed') {
    const isAuthRejection = errorKind === 'auth-rejection';
    const isVersionMismatch = errorKind === 'version-mismatch';
    const isBiometric = errorKind === 'biometric-cancelled';
    const isBiometricError = errorKind === 'biometric-error';
    const isDeviceKeyError = errorKind === 'device-key-error';

    const headline = isAuthRejection
      ? 'Device not recognized'
      : isVersionMismatch
        ? 'Please update'
        : isBiometric
          ? 'Authentication cancelled'
          : isBiometricError
            ? 'Biometric authentication failed'
            : isDeviceKeyError
              ? 'Device Key unavailable'
              : 'Connection lost';

    const subtext = isAuthRejection
      ? 'Scan QR to re-pair your device'
      : isVersionMismatch
        ? 'Update the app or the CLI to the same version'
        : isBiometric
          ? 'Biometric authentication was cancelled. Tap Retry to try again.'
          : isBiometricError
            ? 'Android could not complete biometric authentication. Tap Retry to try again.'
            : isDeviceKeyError
              ? 'The Device Key is missing or invalidated. Re-scan the QR code to pair again.'
              : detail || 'Is the CLI running on your Station?';

    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorKicker}>SESSION ERROR</Text>
          <Text style={styles.errorHeadline}>{headline}</Text>
          <Text style={styles.errorDetail}>{subtext}</Text>
          {!isAuthRejection && !isDeviceKeyError && (
            <Button
              label="Retry"
              variant="primary"
              onPress={handleRetry}
              accessibilityLabel="Retry connection"
            />
          )}
          <Button
            label="Re-scan QR"
            variant="secondary"
            onPress={handleReScan}
            accessibilityLabel="Re-scan QR code"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      <StatusBar style="light" />
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusInfo}>
          <Status
            label={
              connState === 'connected'
                ? stationName
                : connState === 'reconnecting'
                  ? 'Reconnecting'
                  : `Connecting / ${stationName}`
            }
            tone={
              connState === 'connected'
                ? 'success'
                : connState === 'reconnecting'
                  ? 'warning'
                  : 'neutral'
            }
          />
          {latencyStats && (
            <Text style={styles.latencyText} accessibilityLabel="Terminal latency">
              P50 {latencyStats.p50}ms · P95 {latencyStats.p95}ms
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => router.navigate('/git' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open Git"
        >
          <Text style={styles.navLink}>Git</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => router.navigate('/stations' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open Stations"
        >
          <Text style={styles.navLink}>Stations</Text>
        </TouchableOpacity>
      </View>

      {/* Terminal WebView (always mounted; overlay shown on top when not connected) */}
      <View style={styles.terminalWrapper}>
        <View style={styles.viewControls}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => termRef.current?.fit()}
            accessibilityRole="button"
            accessibilityLabel="Fit terminal"
          >
            <Text style={styles.controlText}>Fit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => termRef.current?.adjustFontSize(-1)}
            accessibilityRole="button"
            accessibilityLabel="Decrease font size"
          >
            <Text style={styles.controlText}>A−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => termRef.current?.adjustFontSize(1)}
            accessibilityRole="button"
            accessibilityLabel="Increase font size"
          >
            <Text style={styles.controlText}>A+</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlButton, keyboardVisible && styles.controlButtonActive]}
            onPress={toggleKeyboard}
            accessibilityRole="button"
            accessibilityState={{ selected: keyboardVisible }}
            accessibilityLabel={keyboardVisible ? 'Hide keyboard' : 'Show keyboard'}
          >
            <Text
              style={[
                styles.controlText,
                styles.keyboardIcon,
                keyboardVisible && styles.controlActive,
              ]}
            >
              ⌨
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlButton, selectionMode && styles.controlButtonActive]}
            onPress={toggleSelection}
            accessibilityRole="button"
            accessibilityState={{ selected: selectionMode }}
            accessibilityLabel="Toggle terminal selection"
          >
            <Text style={[styles.controlText, selectionMode && styles.controlActive]}>Select</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => termRef.current?.copySelection()}
            accessibilityRole="button"
            accessibilityLabel="Copy terminal selection"
          >
            <Text style={styles.controlText}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={pasteClipboard}
            accessibilityRole="button"
            accessibilityLabel="Paste into terminal"
          >
            <Text style={styles.controlText}>Paste</Text>
          </TouchableOpacity>
        </View>
        <TerminalView
          ref={termRef}
          onReady={handleTerminalReady}
          onSnapshotApplied={handleSnapshotApplied}
          onInput={handleTermInput}
          onFontSize={handleFontSize}
          onCopy={(data) => void Clipboard.setStringAsync(data)}
          onLatencyStats={(n, p50, p95) => {
            setLatencyStats({ n, p50, p95 });
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.terminal },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
    minHeight: 60,
    paddingHorizontal: spacing.x2,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
    backgroundColor: colors.canvas,
  },
  statusInfo: { flex: 1, gap: 2 },
  latencyText: { ...type.meta, fontSize: 9 },
  navButton: { minHeight: minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.x2 },
  navLink: {
    color: colors.ink,
    fontFamily: fonts.monoSemiBold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  terminalWrapper: { flex: 1, position: 'relative' },
  viewControls: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouchTarget,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  controlButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  controlButtonActive: { backgroundColor: colors.ink },
  controlText: {
    color: colors.ink,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
  },
  keyboardIcon: { fontSize: 18, lineHeight: 22 },
  controlActive: {
    color: colors.canvas,
    fontFamily: fonts.monoBold,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x4,
    padding: spacing.x8,
  },
  errorKicker: { ...type.label, color: colors.danger },
  errorHeadline: {
    ...type.title,
    color: colors.danger,
    textAlign: 'center',
  },
  errorDetail: {
    ...type.body,
    color: colors.muted,
    textAlign: 'center',
  },
});
