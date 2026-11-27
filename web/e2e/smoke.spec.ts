import { test, expect } from '@playwright/test';

test('one click starts a timer; restarting returns to the order ticket', async ({ page }) => {
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

  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByText('Restart this timer?')).toBeVisible();
  await page.getByRole('button', { name: 'Restart' }).click();
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
    await expect(scene.locator(':scope > *')).toBeVisible(); // drinks loaded
    const running = await scene.boundingBox();

    // Backdate the saved timer so it finished long ago, then reload into the done state.
    await page.evaluate(() => {
      const t = JSON.parse(localStorage.getItem('cafe:timer')!);
      t.anchorAt -= 4 * 3600_000;
      localStorage.setItem('cafe:timer', JSON.stringify(t));
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
    await expect(scene.locator(':scope > *')).toBeVisible();
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

  test.describe('with the clock on', () => {
    test.beforeEach(async ({ page }) => {
      await page.route('**/api/**', (route) => route.abort());
      await page.addInitScript(() => localStorage.setItem('cafe:clockShow', 'true'));
    });

    test('the scene does not move when the drink is done', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Start brewing' }).click();
      await expect(page.getByRole('timer')).toBeVisible();
      await expect(page.locator('.head time')).toBeVisible();
      const scene = page.locator('.column .scene');
      await expect(scene.locator(':scope > *')).toBeVisible(); // drinks loaded
      const running = await scene.boundingBox();

      await page.evaluate(() => {
        const t = JSON.parse(localStorage.getItem('cafe:timer')!);
        t.anchorAt -= 4 * 3600_000;
        localStorage.setItem('cafe:timer', JSON.stringify(t));
      });
      await page.reload();
      await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
      await expect(page.locator('.head time')).toBeVisible();
      await expect(scene.locator(':scope > *')).toBeVisible();
      const done = await scene.boundingBox();
      expect(Math.abs(done!.y - running!.y)).toBeLessThanOrEqual(1);
    });

    test('the running screen fits without scrolling', async ({ page }, info) => {
      const sizes =
        info.project.name === 'desktop'
          ? [
              { width: 1280, height: 720 },
              { width: 1440, height: 900 },
            ]
          : [null];
      for (const size of sizes) {
        if (size) await page.setViewportSize(size);
        await page.goto('/');
        await page.getByRole('button', { name: 'Start brewing' }).click();
        await expect(page.getByRole('timer')).toBeVisible();
        const fits = await page.evaluate(
          () => document.documentElement.scrollHeight <= window.innerHeight,
        );
        expect(fits).toBe(true);
        await page.getByRole('button', { name: 'Restart' }).click();
        await page.getByRole('button', { name: 'Restart' }).click();
      }
    });

    test('the setup screen shows the time in the right half on wide windows', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'desktop', 'desktop layout');
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      const box = await page.locator('time').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(640);
      expect(Math.abs(box!.x + box!.width / 2 - 960)).toBeLessThanOrEqual(2);
      await page.setViewportSize({ width: 800, height: 720 });
      await expect(page.locator('time')).toBeHidden();
    });
  });
});

test('a saved mix in Settings loads from its name and opens its background picker', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  const name = page.getByRole('button', { name: 'Rainy day', exact: true });
  const pic = page.getByRole('button', { name: 'Backgrounds for Rainy day' });
  await name.click();
  await expect(name).toHaveAttribute('aria-pressed', 'true');

  await pic.click();
  const picker = page.getByRole('group', { name: 'Backgrounds for Rainy day' });
  await expect(picker).toBeInViewport({ ratio: 1 });
  await expect(picker.getByText('Start this mix when the background changes to:')).toBeVisible();
  await picker.getByRole('checkbox').first().click();
  await expect(picker).toBeVisible();

  await pic.click();
  await expect(picker).toBeHidden();
});

test('Escape in a mix rename box or background picker closes only that, not Settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });

  await dialog.getByRole('button', { name: 'Rename Rainy day' }).click();
  const rename = dialog.getByRole('textbox', { name: 'New name for Rainy day' });
  await rename.fill('Storm');
  await rename.press('Escape');
  await expect(rename).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rainy day', exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Backgrounds for Rainy day' }).click();
  const picker = page.getByRole('group', { name: 'Backgrounds for Rainy day' });
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the drink picked on the order ticket is the one brewed', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/');
  const matcha = page.getByRole('radio', { name: 'Matcha latte' });
  await matcha.check();
  await expect(matcha).toBeChecked();
  await expect(page.locator('.picker .current')).toHaveText('Matcha latte');

  // The choice survives a reload, then follows the timer to the end.
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Matcha latte' })).toBeChecked();
  await page.getByRole('button', { name: 'Start brewing' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('cafe:timer')!);
    t.anchorAt -= 4 * 3600_000;
    localStorage.setItem('cafe:timer', JSON.stringify(t));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your matcha latte is ready' })).toBeVisible();
});
