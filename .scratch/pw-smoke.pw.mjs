import { test } from '@playwright/test';

test('smoke', async ({ page }) => {
  await page.setContent('<title>smoke</title>');
});
