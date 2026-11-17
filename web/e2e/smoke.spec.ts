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

test.describe('timer layout', () => {
  test('receipt docks top-left, scene is centred, collapse persists', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop layout');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start brewing' }).click();
    await expect(page.getByRole('timer')).toBeVisible();

    const receipt = page.locator('aside.receipt');
    const box = await receipt.boundingBox();
    expect(box!.x).toBeLessThan(100);

    const scene = page.locator('.column .scene');
    const sceneBox = await scene.boundingBox();
    expect(Math.abs(sceneBox!.x + sceneBox!.width / 2 - 720)).toBeLessThanOrEqual(2);

    const bar = page.getByRole('button', { name: /To do/ });
    const list = page.getByRole('textbox', { name: 'New task' });
    await expect(list).toBeVisible();
    await bar.click();
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();

    await page.reload();
    await expect(page.getByRole('button', { name: /To do/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: /To do/ }).click();
    await expect(list).toBeVisible();
  });

  test('the scene does not move when the drink is done', async ({ page }) => {
    // Without the server, the saved (backdated) timer is not replaced by the room's copy.
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Start brewing' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    const scene = page.locator('.column .scene');
    const running = await scene.boundingBox();

    // Backdate the saved timer so it finished long ago, then reload into the done state.
    await page.evaluate(() => {
      const t = JSON.parse(localStorage.getItem('cafe:timer')!);
      t.anchorAt -= 4 * 3600_000;
      localStorage.setItem('cafe:timer', JSON.stringify(t));
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
    const done = await scene.boundingBox();
    expect(Math.abs(done!.y - running!.y)).toBeLessThanOrEqual(1);
  });

  test('the running screen fits without scrolling', async ({ page }, info) => {
    // Desktop at 1280x720 (the tight case); the phone project keeps the Pixel 7 viewport.
    if (info.project.name === 'desktop') await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start brewing' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    const fits = await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    );
    expect(fits).toBe(true);
  });
});
