import { test, expect, type Page } from '@playwright/test';

// Screenshot comparisons of the main screens. They catch visual changes the layout checks
// cannot (colours, pixel art, spacing). After an intended visual change, look at the new
// screenshots and accept them with: npm run e2e -- visual --update-snapshots
// Baselines are per browser and OS (the file names end in -darwin), so a Linux machine or CI
// needs its own.

const FIXED = new Date('2026-01-05T09:41:00');

async function open(page: Page) {
  await page.route('**/api/**', (route) => route.abort());
  await page.clock.install({ time: FIXED });
  await page.addInitScript(() => {
    localStorage.setItem('cafe:name', JSON.stringify('Mocha Otter'));
  });
  await page.goto('/');
}

const shot = { animations: 'disabled', fullPage: false, maxDiffPixelRatio: 0.01 } as const;

test('setup screen', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Your order' })).toBeVisible();
  await expect(page).toHaveScreenshot('setup.png', shot);
});

test('timer screen', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Start brewing' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page).toHaveScreenshot('timer.png', shot);
});

test('settings', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeInViewport({ ratio: 1 });
  await expect(page).toHaveScreenshot('settings.png', shot);
});
