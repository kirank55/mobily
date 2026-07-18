import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.pw.mjs',
  fullyParallel: false,
  reporter: 'line',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 390, height: 720 },
  },
});
