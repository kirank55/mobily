import { requireNativeModule } from 'expo-modules-core';
import { notificationText } from './text';

interface MobilyForegroundModule {
  requestNotificationPermission(): Promise<boolean>;
  start(stationName: string): Promise<void>;
  update(state: string, lastLine: string, alert?: string): Promise<void>;
  stop(): Promise<void>;
}

let cachedModule: MobilyForegroundModule | null = null;
function nativeModule(): MobilyForegroundModule {
  cachedModule ??= requireNativeModule<MobilyForegroundModule>('MobilyForeground');
  return cachedModule;
}

export const foregroundNotification = {
  async requestNotificationPermission(): Promise<boolean> {
    return await nativeModule().requestNotificationPermission();
  },

  async start(stationName: string): Promise<void> {
    await nativeModule().start(notificationText(stationName, 80, 'Station'));
  },

  async update(state: string, lastLine: string, alert?: string): Promise<void> {
    await nativeModule().update(
      notificationText(state, 40, 'connected'),
      notificationText(lastLine, 160, 'Waiting for terminal output'),
      alert === undefined ? undefined : notificationText(alert, 512),
    );
  },

  async stop(): Promise<void> {
    await nativeModule().stop();
  },
};
