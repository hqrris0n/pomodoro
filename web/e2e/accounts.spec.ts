import { test, expect, type Browser, type Page } from '@playwright/test';

// Needs the Go server from this tree serving this build (see rooms.spec.ts):
//   E2E_SERVER=http://localhost:18080 npm run e2e -- accounts
// The server keeps accounts and caps them, so each test deletes what it creates.
// One run makes 7 login/sign-up attempts from 127.0.0.1 and the server allows 20
// per address per minute, so a third run within a minute fails with "Too many
// attempts" (the limit working). Wait a minute between repeated runs.
const server = process.env.E2E_SERVER;
const password = 'correct horse';
// The server hashes passwords on purpose slowly, two at a time, so replies queue under load.
const slow = { timeout: 20_000 };

function uniqueName() {
  return `Ada${Date.now() % 1e6}${Math.floor(Math.random() * 1000)}`;
}

async function device(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${server}/`);
  return { context, page };
}

async function authenticate(page: Page, button: 'Log in' | 'Sign up', name: string, pass: string) {
  await page.getByRole('textbox', { name: 'Username' }).fill(name);
  await page.getByLabel('Password', { exact: true }).fill(pass);
  await page.getByRole('button', { name: button, exact: true }).click();
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
}

async function deleteAccount(page: Page, pass: string) {
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await dialog.getByLabel('Password', { exact: true }).fill(pass);
  await dialog.getByRole('button', { name: 'Delete account' }).last().click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('heading', { name: 'Order for', exact: true })).toBeVisible(slow);
}

test('a taken username is refused, and logging in elsewhere logs the first device out', async ({
  browser,
}, info) => {
  test.skip(!server, 'set E2E_SERVER to the URL of the Go server from this tree');
  test.skip(info.project.name !== 'desktop', 'one run is enough; both would share the server');
  test.setTimeout(60_000);

  const name = uniqueName();
  const a = await device(browser);
  const b = await device(browser);
  let loggedInB = false;
  try {
    await authenticate(a.page, 'Sign up', name, password);
    await expect(a.page.getByRole('heading', { name: `Order for ${name}` })).toBeVisible(slow);

    await authenticate(b.page, 'Sign up', name.toUpperCase(), password);
    await expect(b.page.getByRole('alert')).toHaveText('That username is taken.', slow);

    await authenticate(b.page, 'Log in', name, password);
    await expect(b.page.getByRole('heading', { name: `Order for ${name}` })).toBeVisible(slow);
    loggedInB = true;

    await expect(a.page.getByRole('heading', { name: 'Order for', exact: true })).toBeVisible(slow);
    await expect(a.page.getByRole('status')).toHaveText('You were logged in somewhere else.', slow);
  } finally {
    if (loggedInB) await deleteAccount(b.page, password).catch(() => {});
    await a.context.close();
    await b.context.close();
  }
});

test('after changing the password, the old one fails and the new one works', async ({
  browser,
}, info) => {
  test.skip(!server, 'set E2E_SERVER to the URL of the Go server from this tree');
  test.skip(info.project.name !== 'desktop', 'one run is enough; both would share the server');
  test.setTimeout(60_000);

  const name = uniqueName();
  const next = 'battery staple';
  const { context, page } = await device(browser);
  try {
    await authenticate(page, 'Sign up', name, password);
    await expect(page.getByRole('heading', { name: `Order for ${name}` })).toBeVisible();

    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByLabel('Current password').fill(password);
    await dialog.getByLabel('New password').fill(next);
    await dialog.locator('form').getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Password changed.')).toBeVisible(slow);
    await dialog.getByRole('button', { name: 'Log out' }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.getByRole('heading', { name: 'Order for', exact: true })).toBeVisible(slow);

    await authenticate(page, 'Log in', name, password);
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password.', slow);

    await authenticate(page, 'Log in', name, next);
    await expect(page.getByRole('heading', { name: `Order for ${name}` })).toBeVisible(slow);
    await deleteAccount(page, next);
  } finally {
    await context.close();
  }
});
