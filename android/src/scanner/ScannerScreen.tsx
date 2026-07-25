/**
 * Native QR pairing. The camera remains an immersive product surface while
 * application chrome follows the Soft Console design system.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { pairWithStation } from '@/auth/pairing';
import { Button, Screen, StatePanel } from '@/ui/components';
import { colors, fonts, spacing, type } from '@/ui/theme';
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
  }

  function retryScanning() {
    scannedRef.current = false;
    invalidQrLoggedRef.current = false;
    setErrorMsg('');
    setStatus('scanning');
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
      <Screen>
        <StatePanel label="Checking camera" loading />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <StatePanel
          label="Camera permission required"
          detail="Mobily uses the camera only to scan the one-time pairing QR code shown by your Station."
          action={<Button label="Grant permission" variant="primary" onPress={requestPermission} />}
        />
      </Screen>
    );
  }

  if (status === 'pairing') {
    return (
      <Screen>
        <StatePanel
          label="Pairing with Station"
          detail="Creating this phone's Device Key."
          loading
        />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen>
        <StatePanel
          label="Pairing failed"
          detail={errorMsg}
          tone="danger"
          action={
            <View style={styles.errorActions}>
              <Button label="Scan again" variant="primary" onPress={retryScanning} />
              <Button label="Stations" onPress={() => router.replace('/stations')} />
            </View>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      <StatusBar style="light" />
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => handleBarcodeScanned(data)}
      />
      <View style={styles.overlay}>
        <Text style={styles.kicker}>02 / PAIR STATION</Text>
        <View style={styles.scanFrame} />
        <View style={styles.hintPanel}>
          <Text style={styles.scanHint}>ALIGN THE STATION QR INSIDE THE FRAME</Text>
          <Text style={styles.scanDetail}>The code expires after ten minutes.</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.terminal },
  camera: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    position: 'absolute',
    top: spacing.x4,
    left: spacing.x4,
    right: spacing.x4,
    color: colors.terminalInk,
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    letterSpacing: 0.7,
    textAlign: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: colors.terminalInk,
    backgroundColor: 'transparent',
  },
  hintPanel: {
    marginTop: spacing.x4,
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x3,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.canvas,
  },
  scanHint: {
    color: colors.canvas,
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  scanDetail: { ...type.body, color: colors.border, marginTop: spacing.x1, textAlign: 'center' },
  errorActions: { gap: spacing.x2, width: '100%', maxWidth: 320 },
});
