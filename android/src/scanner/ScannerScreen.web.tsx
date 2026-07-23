/**
 * Web pairing fallback for local Expo development. Native Android pairs by QR.
 */

import { PROTOCOL_VERSION, type PairingPayload } from '@mobily/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { pairWithStation } from '@/auth/pairing';
import { allowInsecureStationTransport } from '@/dev/insecureTransport';
import { Button, Field, Screen, StatePanel, Status, TopBar } from '@/ui/components';
import { colors, spacing, type } from '@/ui/theme';
import { parseQrPayload } from './parseQrPayload';

export default function ScannerScreen() {
  const [qrPaste, setQrPaste] = useState('');
  const [endpoint, setEndpoint] = useState('ws://localhost:');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'pairing' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function runPair(pairing: PairingPayload) {
    setStatus('pairing');
    setErrorMsg('');
    let result;
    try {
      result = await pairWithStation(pairing, {
        allowInsecureTransport: allowInsecureStationTransport(),
      });
    } catch (error) {
      console.error('[Mobily][WebPair] Unexpected pairing failure', error);
      setStatus('error');
      setErrorMsg('Unexpected pairing failure. See the console for details.');
      return;
    }

    if (result.ok && result.record) {
      console.info('[Mobily][WebPair] Pairing succeeded; opening terminal');
      router.replace('/terminal');
      return;
    }
    setStatus('error');
    setErrorMsg(result.error ?? 'Pairing failed');
  }

  async function handlePasteQr() {
    const parsed = parseQrPayload(qrPaste);
    if (!parsed) {
      setStatus('error');
      setErrorMsg('Paste a full mobily://pair payload from the CLI QR.');
      return;
    }
    await runPair(parsed);
  }

  async function handleManual() {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedEndpoint = endpoint.trim();
    if (!trimmedCode || !trimmedEndpoint) {
      setStatus('error');
      setErrorMsg('Enter both the Station WebSocket URL and the pairing code.');
      return;
    }
    try {
      new URL(trimmedEndpoint);
    } catch {
      setStatus('error');
      setErrorMsg('Endpoint must be a valid ws:// or wss:// URL.');
      return;
    }
    await runPair({
      endpoint: trimmedEndpoint,
      code: trimmedCode,
      expiresAt: Date.now() + 10 * 60 * 1000,
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  if (status === 'pairing') {
    return (
      <Screen>
        <StatePanel
          label="Pairing with Station"
          detail="Creating this browser's Device Key."
          loading
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <TopBar eyebrow="02 / Pair Station" title="Connect the local web client" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Start the CLI with --tunnel local --allow-insecure-local, then use either pairing method
          below.
        </Text>

        {status === 'error' ? (
          <View style={styles.errorPanel} accessibilityLiveRegion="polite">
            <Status label="Pairing error" tone="danger" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.panelIndex}>01 / QR PAYLOAD</Text>
          <Field
            label="QR payload"
            value={qrPaste}
            onChangeText={setQrPaste}
            placeholder="mobily://pair?v=2&endpoint=..."
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={styles.multiline}
          />
          <Button
            label="Pair from payload"
            variant="primary"
            onPress={() => void handlePasteQr()}
          />
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelIndex}>02 / MANUAL</Text>
          <Field
            label="WebSocket endpoint"
            value={endpoint}
            onChangeText={setEndpoint}
            placeholder="ws://localhost:51234"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="Pairing code"
            value={code}
            onChangeText={setCode}
            placeholder="ABCD2345"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />
          <Button label="Pair and connect" variant="primary" onPress={() => void handleManual()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.x4,
    gap: spacing.x4,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  intro: { ...type.body, color: colors.muted },
  panel: {
    gap: spacing.x4,
    padding: spacing.x4,
    borderWidth: 1,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  panelIndex: { ...type.label, color: colors.muted },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  errorPanel: {
    gap: spacing.x3,
    padding: spacing.x3,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  errorText: { ...type.body, color: colors.danger },
});
