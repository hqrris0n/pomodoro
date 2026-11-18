import { test, expect, type Browser } from '@playwright/test';

// Needs the Go server from this tree serving this build, which gives one origin
// for the pages and /api. Opt in with its URL, for example:
//   npm run build && (cd ../server && go run . -port 18080 -static ../web/dist)
//   E2E_SERVER=http://localhost:18080 npm run e2e -- rooms
// It is opt-in because a server already on :8080 may be an older build.
const server = process.env.E2E_SERVER;

async function personNamed(browser: Browser, name: string) {
  const context = await browser.newContext();
  await context.addInitScript((n) => localStorage.setItem('cafe:name', JSON.stringify(n)), name);
  const page = await context.newPage();
  await page.goto(`${server}/`);
  return { context, page };
}

test('a guest waits while the host restarts, then follows the next timer', async ({
  browser,
}, info) => {
  test.skip(!server, 'set E2E_SERVER to the URL of the Go server from this tree');
  test.skip(info.project.name !== 'desktop', 'one run is enough; both would share the server');

  const hostName = `Host ${Date.now() % 100000}`;
  const host = await personNamed(browser, hostName);
  const guest = await personNamed(browser, 'Guest Gus');
  try {
    await host.page.getByRole('button', { name: 'Start brewing' }).click();
    await expect(host.page.getByRole('timer')).toBeVisible();

    await guest.page.getByRole('button', { name: /Other timers/ }).click();
    const entry = guest.page.locator('li.room', { hasText: hostName });
    await entry.getByRole('button', { name: 'Join' }).click();
    await guest.page.keyboard.press('Escape');
    await expect(guest.page.getByText(`Following ${hostName}'s timer`)).toBeVisible();

    // The host restarts: back to the order ticket, while the guest waits in the room.
    await host.page.getByRole('button', { name: 'Restart' }).click();
    await expect(host.page.getByText('Restart this timer?')).toBeVisible();
    await host.page.getByRole('button', { name: 'Restart' }).click();
    await expect(host.page.getByRole('heading', { name: 'Your order' })).toBeVisible();
    await expect(
      guest.page.getByRole('heading', { name: `Waiting for ${hostName} to order…` }),
    ).toBeVisible();
    await expect(guest.page.getByRole('heading', { name: 'Your order' })).toBeHidden();

    // The next order goes into the same room and the guest follows it.
    await host.page.getByRole('button', { name: 'Start brewing' }).click();
    await expect(host.page.getByRole('timer')).toBeVisible();
    await expect(guest.page.getByRole('timer')).toBeVisible();
    await expect(guest.page.getByText(`Following ${hostName}'s timer`)).toBeVisible();

    // The guest leaves and is back at their own order ticket; the host keeps brewing.
    await guest.page.getByRole('button', { name: 'Leave' }).click();
    await expect(guest.page.getByText('Leave this timer?')).toBeVisible();
    await guest.page.getByRole('button', { name: 'Leave' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Your order' })).toBeVisible();
    await expect(host.page.getByRole('timer')).toBeVisible();
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
