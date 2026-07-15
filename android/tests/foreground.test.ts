import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  requestNotificationPermission: vi.fn(),
  start: vi.fn(),
  update: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('expo-modules-core', () => ({ requireNativeModule: () => native }));

import { foregroundNotification } from '@/foreground/foreground';
import {
  ForegroundConnectionController,
  type ForegroundNotification,
} from '@/foreground/controller';

describe('foreground notification module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.requestNotificationPermission.mockResolvedValue(true);
    native.start.mockResolvedValue(undefined);
    native.update.mockResolvedValue(undefined);
    native.stop.mockResolvedValue(undefined);
  });

  it('bounds and sanitizes notification text before crossing the native boundary', async () => {
    await foregroundNotification.start(`\u001b[31m${'S'.repeat(100)}\u001b[0m`);
    await foregroundNotification.update(
      'connected\nignored',
      `\u001b[32m${'L'.repeat(220)}\u001b[0m`,
      `\u0007${'A'.repeat(600)}`,
    );

    expect(native.start).toHaveBeenCalledWith('S'.repeat(80));
    expect(native.update).toHaveBeenCalledWith(
      'connected ignored',
      'L'.repeat(160),
      'A'.repeat(512),
    );
  });
});

describe('ForegroundConnectionController', () => {
  function createNotifications(): ForegroundNotification {
    return {
      requestNotificationPermission: vi.fn().mockResolvedValue(true),
      start: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('owns permission, service lifecycle, connection state, and alert updates', async () => {
    const notifications = createNotifications();
    const controller = new ForegroundConnectionController(notifications, 25);

    await controller.connect('Workstation');
    await controller.updateState('connected');
    await controller.alert('Approve the deployment?');
    await controller.disconnect();

    expect(notifications.requestNotificationPermission).toHaveBeenCalledOnce();
    expect(notifications.start).toHaveBeenCalledWith('Workstation');
    expect(notifications.update).toHaveBeenLastCalledWith(
      'connected',
      'Waiting for terminal output',
      'Approve the deployment?',
    );
    expect(notifications.stop).toHaveBeenCalledOnce();
  });

  it('coalesces output chunks and keeps the latest meaningful terminal line', async () => {
    vi.useFakeTimers();
    try {
      const notifications = createNotifications();
      const controller = new ForegroundConnectionController(notifications, 25);
      await controller.connect('Workstation');
      vi.mocked(notifications.update).mockClear();

      controller.recordOutput('\u001b[32mcompiling\u001b[0m\n');
      controller.recordOutput('tests ');
      controller.recordOutput('passed\r\n');
      await vi.advanceTimersByTimeAsync(25);

      expect(notifications.update).toHaveBeenCalledOnce();
      expect(notifications.update).toHaveBeenCalledWith(
        'connecting',
        'tests passed',
        undefined,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not start a stale service when disconnect wins a permission race', async () => {
    let resolvePermission!: (granted: boolean) => void;
    const notifications = createNotifications();
    vi.mocked(notifications.requestNotificationPermission).mockReturnValue(
      new Promise((resolve) => {
        resolvePermission = resolve;
      }),
    );
    const controller = new ForegroundConnectionController(notifications);

    const connecting = controller.connect('Workstation');
    await controller.disconnect();
    resolvePermission(true);
    await connecting;

    expect(notifications.start).not.toHaveBeenCalled();
  });
});
