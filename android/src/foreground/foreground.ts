import { requireNativeModule } from 'expo-modules-core';

interface MobilyForegroundModule {
  requestNotificationPermission(): Promise<boolean>;
  start(): Promise<void>;
  update(connected: boolean): Promise<void>;
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

  async start(): Promise<void> {
    await nativeModule().start();
  },

  async update(connected: boolean): Promise<void> {
    await nativeModule().update(connected);
  },

  async stop(): Promise<void> {
    await nativeModule().stop();
  },
};
