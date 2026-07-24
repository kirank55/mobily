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

  it('sends only whether the terminal is connected to Android', async () => {
    await foregroundNotification.start();
    await foregroundNotification.update(true);

    expect(native.start).toHaveBeenCalledWith();
    expect(native.update).toHaveBeenCalledWith(true);
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

  it('owns permission, service lifecycle, and binary connection updates', async () => {
    const notifications = createNotifications();
    const controller = new ForegroundConnectionController(notifications);

    await controller.connect('Workstation');
    await controller.updateState('connected');
    await controller.alert('Approve the deployment?');
    await controller.disconnect();

    expect(notifications.requestNotificationPermission).toHaveBeenCalledOnce();
    expect(notifications.start).toHaveBeenCalledWith();
    expect(notifications.update).toHaveBeenLastCalledWith(true);
    expect(notifications.stop).toHaveBeenCalledOnce();
  });

  it('does not expose session phases or alert contents in notifications', async () => {
    const notifications = createNotifications();
    const controller = new ForegroundConnectionController(notifications);
    await controller.connect('Workstation');
    await controller.updateState('connected');
    vi.mocked(notifications.update).mockClear();

    await controller.updatePhase('waiting', 'Approve tool call?');
    await controller.alert('Approve the deployment?');

    expect(notifications.update).not.toHaveBeenCalled();
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
