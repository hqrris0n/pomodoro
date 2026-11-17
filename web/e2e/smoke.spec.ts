import { test, expect } from '@playwright/test';

test('one click starts a timer; leaving returns to the order ticket', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your order' })).toBeVisible();

  await page.getByRole('button', { name: 'Start brewing' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page).toHaveTitle(/Focus/);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  // A reload restores the paused timer.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByText('Leave this timer?')).toBeVisible();
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'Your order' })).toBeVisible();
});

test('todos survive from the order ticket to the timer screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New task' }).fill('Read chapter 4');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Start brewing' }).click();

  const bar = page.getByRole('button', { name: /To do/ });
  if (await bar.isVisible()) await bar.click();
  await expect(page.getByText('Read chapter 4')).toBeVisible();
});
