/**
 * src/scanner/ScannerScreen.tsx
 *
 * QR scanner screen using expo-camera. Scans the pairing code,
 * then triggers the pairing flow (Device Key creation + HTTP handshake).
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState, useRef } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pairWithStation } from '@/auth/pairing';
import { parseQrPayload } from './parseQrPayload';

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<'scanning' | 'pairing' | 'error'>('scanning');
  const [errorMsg, setErrorMsg] = useState('');
  const scannedRef = useRef(false);
  const invalidQrLoggedRef = useRef(false);

  function showPairingError(message: string) {
    setStatus('error');
    setErrorMsg(message);
    setTimeout(() => {
      scannedRef.current = false;
      setStatus('scanning');
    }, 3000);
  }

  async function handleBarcodeScanned(data: string) {
    if (scannedRef.current) return;
    const parsed = parseQrPayload(data);
    if (!parsed) {
      if (!invalidQrLoggedRef.current) {
        invalidQrLoggedRef.current = true;
        console.warn('[Mobily][Scanner] Ignored a QR code that is not a valid Mobily payload');
      }
      return;
    }

    scannedRef.current = true;
    console.info('[Mobily][Scanner] Valid Mobily QR detected; starting pairing');
    setStatus('pairing');
    setErrorMsg('');

    let result;
    try {
      result = await pairWithStation(parsed);
    } catch (error) {
      console.error('[Mobily][Scanner] Unexpected pairing failure', error);
      showPairingError('Unexpected pairing failure. See the console for details.');
      return;
    }

    if (result.ok && result.record) {
      console.info('[Mobily][Scanner] Pairing succeeded; opening terminal');
      router.replace('/terminal');
    } else {
      console.warn('[Mobily][Scanner] Pairing did not complete', {
        reason: result.error ?? 'Pairing failed',
      });
      showPairingError(result.error ?? 'Pairing failed');
    }
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Camera access is required to scan the QR code.</Text>
        <Text style={styles.button} onPress={requestPermission}>
          Grant permission
        </Text>
      </View>
    );
  }

  if (status === 'pairing') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>Pairing with Station…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{errorMsg}</Text>
        <Text style={styles.hint}>Retrying in a moment…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => handleBarcodeScanned(data)}
      />
      <View style={styles.overlay}>
        <View style={styles.scanFrame} />
        <Text style={styles.scanHint}>Point at the QR code on your Station</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#2ea043',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  scanHint: {
    color: '#fff',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  message: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
  },
  error: {
    fontSize: 16,
    color: '#da3633',
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: '#9a9a9a',
  },
  button: {
    fontSize: 16,
    color: '#2ea043',
    fontWeight: '600',
    marginTop: 8,
  },
});
