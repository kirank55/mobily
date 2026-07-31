import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './.scratch',
  testMatch: '**/pw-smoke.pw.mjs',
  reporter: 'line',
  use: { browserName: 'chromium', headless: true },
});
