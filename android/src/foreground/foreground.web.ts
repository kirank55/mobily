/** No-op foreground notifications on Expo web. */

export const foregroundNotification = {
  async requestNotificationPermission(): Promise<boolean> {
    return false;
  },

  async start(_stationName: string): Promise<void> {},

  async update(
    _state: string,
    _phase: string,
    _lastLine: string,
    _alert?: string,
  ): Promise<void> {},

  async stop(): Promise<void> {},
};
