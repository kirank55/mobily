/**
 * Native soft-keyboard control for the terminal WebView.
 *
 * Android will not open the IME from a programmatic textarea focus alone unless
 * the native WebView is the served input connection. This module owns that
 * native show/hide path.
 */

import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface SoftKeyboardResult {
  shown?: boolean;
  hidden?: boolean;
  served: boolean;
  accepted?: boolean;
  reason?: string;
}

interface MobilyTerminalImeModule {
  showSoftKeyboard(): Promise<SoftKeyboardResult>;
  hideSoftKeyboard(): Promise<SoftKeyboardResult>;
}

let cachedModule: MobilyTerminalImeModule | null = null;

function nativeModule(): MobilyTerminalImeModule | null {
  if (Platform.OS !== 'android') return null;
  cachedModule ??= requireNativeModule<MobilyTerminalImeModule>('MobilyTerminalIme');
  return cachedModule;
}

/** Ask Android to serve the terminal WebView and show the soft keyboard. */
export async function showTerminalSoftKeyboard(): Promise<SoftKeyboardResult> {
  const module = nativeModule();
  if (!module) return { shown: false, served: false, reason: 'unsupported-platform' };
  return module.showSoftKeyboard();
}

/** Hide the soft keyboard owned by the terminal WebView when possible. */
export async function hideTerminalSoftKeyboard(): Promise<SoftKeyboardResult> {
  const module = nativeModule();
  if (!module) return { hidden: false, served: false, reason: 'unsupported-platform' };
  return module.hideSoftKeyboard();
}
