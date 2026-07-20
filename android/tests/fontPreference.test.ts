import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);

import {
  DEFAULT_READABLE_FONT_SIZE,
  MAX_READABLE_FONT_SIZE,
} from '@/terminal/terminalDocument';
import { loadTerminalFontSize, saveTerminalFontSize } from '@/terminal/fontPreference';

beforeEach(() => {
  secureStore.getItemAsync.mockReset();
  secureStore.setItemAsync.mockReset();
});

describe('terminal font preference', () => {
  it('defaults to the readable font size and persists explicit changes', async () => {
    secureStore.getItemAsync.mockResolvedValue(null);
    expect(await loadTerminalFontSize()).toBe(DEFAULT_READABLE_FONT_SIZE);

    secureStore.setItemAsync.mockResolvedValue(undefined);
    expect(await saveTerminalFontSize(20)).toBe(20);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('mobily.terminal-font-size.v1', '20');

    secureStore.getItemAsync.mockResolvedValue('20');
    expect(await loadTerminalFontSize()).toBe(20);
  });

  it('clamps corrupted or extreme stored values', async () => {
    secureStore.getItemAsync.mockResolvedValue('999');
    expect(await loadTerminalFontSize()).toBe(MAX_READABLE_FONT_SIZE);
    expect(await saveTerminalFontSize(2)).toBe(10);
  });
});
