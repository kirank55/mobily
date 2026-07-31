import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = {
  showSoftKeyboard: vi.fn(),
  hideSoftKeyboard: vi.fn(),
};

vi.mock('expo-modules-core', () => ({
  requireNativeModule: () => native,
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

describe('terminalIme', () => {
  beforeEach(() => {
    vi.resetModules();
    native.showSoftKeyboard.mockReset();
    native.hideSoftKeyboard.mockReset();
  });

  it('forwards show/hide to the native terminal IME module', async () => {
    native.showSoftKeyboard.mockResolvedValue({ shown: true, served: true });
    native.hideSoftKeyboard.mockResolvedValue({ hidden: true, served: false });

    const { showTerminalSoftKeyboard, hideTerminalSoftKeyboard } = await import(
      '@/terminal/terminalIme'
    );

    await expect(showTerminalSoftKeyboard()).resolves.toEqual({ shown: true, served: true });
    await expect(hideTerminalSoftKeyboard()).resolves.toEqual({ hidden: true, served: false });
    expect(native.showSoftKeyboard).toHaveBeenCalledOnce();
    expect(native.hideSoftKeyboard).toHaveBeenCalledOnce();
  });
});
