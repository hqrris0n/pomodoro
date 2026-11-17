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
      const running = await scene.boundingBox();

      await page.evaluate(() => {
        const t = JSON.parse(localStorage.getItem('cafe:timer')!);
        t.anchorAt -= 4 * 3600_000;
        localStorage.setItem('cafe:timer', JSON.stringify(t));
      });
      await page.reload();
      await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
      await expect(page.locator('.head time')).toBeVisible();
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
        await page.getByRole('button', { name: 'Leave' }).click();
        await page.getByRole('button', { name: 'Leave' }).click();
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

test('signing in from the Order-for card creates a user and saves settings to it', async ({
  page,
}) => {
  // Never reach a real server: other /api calls fail, profiles are mocked in memory.
  await page.route('**/api/**', (route) => route.abort());
  const db = new Map<string, Record<string, unknown>>();
  const puts: { displayName: string; settings: Record<string, unknown> }[] = [];
  await page.route('**/api/profiles**', async (route) => {
    const req = route.request();
    const name = decodeURIComponent(new URL(req.url()).pathname.split('/')[3] ?? '');
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'GET' && !name) {
      return json(200, { profiles: [...db.values()] });
    }
    if (req.method() === 'GET') {
      const p = db.get(name.toLowerCase());
      return p ? json(200, p) : json(404, { error: 'no such profile' });
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      const p = { ...body, updatedAt: Date.now() };
      db.set(body.username.toLowerCase(), p);
      return json(201, p);
    }
    if (req.method() === 'PUT') {
      const body = req.postDataJSON();
      puts.push(body);
      Object.assign(db.get(name.toLowerCase())!, body);
      return json(200, { updatedAt: Date.now() });
    }
    return json(404, { error: 'not found' });
  });

  await page.goto('/');
  await page.getByRole('textbox', { name: 'New task' }).fill('Before signing in');
  await page.getByRole('button', { name: 'Add' }).click();

  const username = page.getByRole('textbox', { name: 'Username' });
  await expect(username).toHaveValue('');
  await expect(username).toHaveAttribute('placeholder', 'username');
  await username.fill('Ada');
  await username.press('Enter');

  // The first user on a device starts with its settings; the display name starts as the username.
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Ada');
  await expect
    .poll(() => db.get('ada')?.settings)
    .toMatchObject({
      todos: [expect.objectContaining({ text: 'Before signing in' })],
    });

  await page.getByRole('textbox', { name: 'New task' }).fill('After signing in');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect
    .poll(() => JSON.stringify(puts.at(-1)?.settings.todos ?? []), { timeout: 5000 })
    .toContain('After signing in');
  expect(puts.at(-1)!.settings).not.toHaveProperty('token');

  // A reload keeps the user signed in.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue('Ada');
});
