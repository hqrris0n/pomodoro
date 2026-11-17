import { test, expect } from '@playwright/test';

test('Start opens the Timer screen and Leave returns to Setup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Timer' })).toBeVisible();
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'Setup' })).toBeVisible();
});
