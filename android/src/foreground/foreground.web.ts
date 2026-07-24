/** No-op foreground notifications on Expo web. */

export const foregroundNotification = {
  async requestNotificationPermission(): Promise<boolean> {
    return false;
  },

  async start(): Promise<void> {},

  async update(_connected: boolean): Promise<void> {},

  async stop(): Promise<void> {},
};
