import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_READABLE_FONT_SIZE,
  clampTerminalFontSize,
} from './terminalDocument';

const FONT_SIZE_STORAGE_KEY = 'mobily.terminal-font-size.v1';

export async function loadTerminalFontSize(): Promise<number> {
  try {
    const stored = await SecureStore.getItemAsync(FONT_SIZE_STORAGE_KEY);
    if (stored == null) return DEFAULT_READABLE_FONT_SIZE;
    return clampTerminalFontSize(Number(stored));
  } catch {
    return DEFAULT_READABLE_FONT_SIZE;
  }
}

export async function saveTerminalFontSize(fontSize: number): Promise<number> {
  const clamped = clampTerminalFontSize(fontSize);
  await SecureStore.setItemAsync(FONT_SIZE_STORAGE_KEY, String(clamped));
  return clamped;
}
