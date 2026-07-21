/**
 * Web pairing screen — paste a Station QR payload or enter endpoint + code.
 * Camera / biometrics are deferred; uses __DEV__ insecure transport.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PROTOCOL_VERSION, type PairingPayload } from '@mobily/shared';
import { pairWithStation } from '@/auth/pairing';
import { allowInsecureStationTransport } from '@/dev/insecureTransport';
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
      setErrorMsg('Paste a full mobily://pair?… payload from the CLI QR.');
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
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>Pairing with Station…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Text style={styles.title}>Pair Station (web)</Text>
      <Text style={styles.hint}>
        Start the CLI with --tunnel local --allow-insecure-local, then paste the QR payload or enter
        ws://localhost:PORT and the pairing code.
      </Text>

      <Text style={styles.label}>QR payload</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={qrPaste}
        onChangeText={setQrPaste}
        placeholder="mobily://pair?v=2&endpoint=…"
        placeholderTextColor="#6a6a6a"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <Pressable style={styles.button} onPress={() => void handlePasteQr()}>
        <Text style={styles.buttonText}>Pair from QR payload</Text>
      </Pressable>

      <Text style={styles.or}>or</Text>

      <Text style={styles.label}>WebSocket endpoint</Text>
      <TextInput
        style={styles.input}
        value={endpoint}
        onChangeText={setEndpoint}
        placeholder="ws://localhost:51234"
        placeholderTextColor="#6a6a6a"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Pairing code</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder="ABCD2345"
        placeholderTextColor="#6a6a6a"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
      />
      <Pressable style={styles.button} onPress={() => void handleManual()}>
        <Text style={styles.buttonText}>Pair & connect</Text>
      </Pressable>

      {status === 'error' ? <Text style={styles.error}>{errorMsg}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    padding: 24,
    gap: 10,
  },
  title: {
    color: '#e6e6e6',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 4,
  },
  hint: {
    color: '#9a9a9a',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  label: {
    color: '#9a9a9a',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e6e6e6',
    backgroundColor: '#161616',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#2ea043',
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  or: {
    color: '#6a6a6a',
    textAlign: 'center',
    marginVertical: 8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#0d1117',
  },
  message: {
    fontSize: 16,
    color: '#ccc',
  },
  error: {
    color: '#da3633',
    marginTop: 12,
    fontSize: 14,
  },
});
