import { test, expect, type Browser, type Page } from '@playwright/test';

// Needs the Go server from this tree serving this build; opt in with its URL:
//   E2E_SERVER=http://localhost:18080 npm run e2e -- claims
const server = process.env.E2E_SERVER;

async function personNamed(browser: Browser, name: string) {
  const context = await browser.newContext();
  await context.addInitScript((n) => localStorage.setItem('cafe:name', JSON.stringify(n)), name);
  const page = await context.newPage();
  await page.goto(`${server}/`);
  return { context, page };
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a greyed-out channel and the saved mixes come back when the co-host lets go', async ({
  browser,
}, info) => {
  test.skip(!server, 'set E2E_SERVER to the URL of the Go server from this tree');
  test.skip(info.project.name !== 'desktop', 'one run is enough; both would share the server');

  const hostName = `Host ${Math.random().toString(36).slice(2, 8)}`;
  const host = await personNamed(browser, hostName);
  const cohost = await personNamed(browser, 'Co-host Cleo');
  try {
    await host.page.getByRole('button', { name: 'Start brewing' }).click();
    await expect(host.page.getByRole('timer')).toBeVisible();

    await cohost.page.getByRole('button', { name: /Other timers/ }).click();
    await cohost.page
      .locator('li.room', { hasText: hostName })
      .getByRole('button', { name: 'Join' })
      .click();
    await cohost.page.keyboard.press('Escape');
    await expect(cohost.page.getByText(`Following ${hostName}'s timer`)).toBeVisible();

    await host.page.getByRole('button', { name: /Other timers/ }).click();
    await host.page.getByRole('button', { name: 'Promote' }).click();
    await host.page.keyboard.press('Escape');

    // The host saves a mix so there is something to load.
    const hostDialog = await openSettings(host.page);
    const hostSwitch = hostDialog.getByRole('checkbox', { name: /^Play / }).first();
    const channel = ((await hostSwitch.getAttribute('aria-label')) ?? '').replace(/^Play /, '');
    expect(channel).not.toBe('');
    await expect(async () => {
      if (!(await hostSwitch.isChecked())) await hostSwitch.click({ force: true });
      await expect(hostSwitch).toBeChecked({ timeout: 1000 });
    }).toPass();
    await hostDialog.getByLabel('Mix name').fill('Held mix');
    await hostDialog.getByRole('button', { name: 'Save', exact: true }).click();
    const hostMix = hostDialog.getByRole('button', { name: 'Held mix', exact: true });
    await expect(hostMix).toBeEnabled();

    const coDialog = await openSettings(cohost.page);
    const coSwitch = coDialog.getByRole('checkbox', { name: `Play ${channel}` });
    const coSlider = coDialog.getByRole('slider', { name: channel, exact: true });
    const coMix = coDialog.getByRole('button', { name: 'Held mix', exact: true });
    await expect(coMix).toBeVisible();
    await expect(coSwitch).toBeEnabled();
    await expect(async () => {
      if (!(await coSwitch.isChecked())) await coSwitch.click({ force: true });
      await expect(coSwitch).toBeChecked({ timeout: 1000 });
    }).toPass();
    await expect(coSlider).toBeEnabled();

    // The co-host presses and holds the slider.
    const box = (await coSlider.boundingBox())!;
    await cohost.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await cohost.page.mouse.down();

    const hostSwitchRow = hostDialog.getByRole('checkbox', { name: `Play ${channel}` });
    const hostSlider = hostDialog.getByRole('slider', { name: channel, exact: true });
    await expect(hostSwitchRow).toBeDisabled();
    await expect(hostSlider).toBeDisabled();
    await expect(hostMix).toBeDisabled();

    const row = hostDialog.locator('li', {
      has: host.page.getByRole('checkbox', { name: `Play ${channel}` }),
    });
    await row.hover();
    const tip = row.getByRole('tooltip');
    await expect(tip).toBeVisible({ timeout: 5000 });
    await expect(tip).toHaveText('Someone is adjusting.');

    await cohost.page.mouse.up();
    await expect(hostSwitchRow).toBeEnabled({ timeout: 5000 });
    await expect(hostMix).toBeEnabled({ timeout: 5000 });
  } finally {
    await host.context.close();
    await cohost.context.close();
  }
});
