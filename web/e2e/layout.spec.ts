import { test, expect, type Page } from '@playwright/test';

// Layout checks: things that look wrong rather than behave wrong, at phone and desktop sizes.
// No server is needed: /api is either refused or faked per test.

type Size = { width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };

// Sizes per project. The phone project keeps its Pixel 7 viewport (null) and adds the
// narrowest phones still common; the desktop project covers both sides of the 900px breakpoint.
const SIZES: Record<string, (Size | null)[]> = {
  phone: [null, { width: 375, height: 667 }, { width: 320, height: 568 }],
  desktop: [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 900, height: 720 },
    { width: 899, height: 720 },
  ],
};

const sizesFor = (project: string) => SIZES[project] ?? [null];
const label = (page: Page) => `${page.viewportSize()!.width}x${page.viewportSize()!.height}`;
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

async function boxOf(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, `${selector} has a box at ${label(page)}`).not.toBeNull();
  return b!;
}

/** The page never scrolls sideways. */
async function expectNoSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, `page width at ${label(page)}`).toBeLessThanOrEqual(width);
}

/** The box lies inside the window horizontally. */
function expectInsideWidth(page: Page, b: Box, what: string) {
  const width = page.viewportSize()!.width;
  expect(b.x, `${what} left edge at ${label(page)}`).toBeGreaterThanOrEqual(0);
  expect(right(b), `${what} right edge at ${label(page)}`).toBeLessThanOrEqual(width);
}

/** No element's text spills out of its own box. */
async function expectNoOverflow(page: Page, selector: string) {
  const spills = await page
    .locator(selector)
    .evaluateAll((els) =>
      els
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.tagName}.${e.className}: ${e.scrollWidth} > ${e.clientWidth}`),
    );
  expect(spills, `${selector} at ${label(page)}`).toEqual([]);
}

// --- fake server pieces -------------------------------------------------------------------

const timer = () => ({
  focusMs: 25 * 60_000,
  breakMs: 5 * 60_000,
  rounds: 2,
  elapsedMs: 0,
  anchorAt: Date.now(),
});
const settings = {
  drinkId: 'latte',
  backgroundId: 'x',
  backgroundRotateMin: 0,
  mix: {},
  mixes: [],
};
const others = [
  { id: 'a', ownerName: 'Hazel Newt', memberCount: 3, drinkId: 'latte', timer: timer() },
  { id: 'b', ownerName: 'Chai Bean', memberCount: 1, drinkId: 'latte', timer: timer() },
];

/** Answers the event stream once with the given room list and room. */
async function fakeEvents(page: Page, room: unknown = null) {
  await page.route('**/api/events**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body:
        `event: rooms\ndata: ${JSON.stringify({ now: Date.now(), rooms: others })}\n\n` +
        `event: room\ndata: ${JSON.stringify({ now: Date.now(), you: 'me', room })}\n\n`,
    }),
  );
}

/** Logs in through the card against a faked account API. */
async function logIn(page: Page) {
  const account = { username: 'Ada', displayName: 'Ada L', settings: {}, updatedAt: 1 };
  await page.route('**/api/auth/login', (route) => route.fulfill({ json: account }));
  await page.route('**/api/account', (route) =>
    route.fulfill({ json: route.request().method() === 'GET' ? account : { updatedAt: 2 } }),
  );
  await page.getByRole('textbox', { name: 'Username' }).fill('Ada');
  await page.getByLabel('Password', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Order for Ada' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
});

// --- Order for card -----------------------------------------------------------------------

async function expectCardLayout(page: Page) {
  await expectNoSideScroll(page);
  const ticket = await boxOf(page, 'main.ticket');
  const card = await boxOf(page, '.order-for .card');
  const clip = await boxOf(page, '.order-for .clip.front');
  const hole = await boxOf(page, '.hole.right');
  const where = label(page);

  // Nothing about the card is cut off by the window.
  expectInsideWidth(page, card, 'card');
  expectInsideWidth(page, clip, 'clip');

  // The text of "Your order" (its box can be wider than the words).
  const words = await page.locator('main.ticket h1').evaluate((h) => {
    const range = document.createRange();
    range.selectNodeContents(h);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const moved = card.y > bottom(words) - 1;
  // It stays on the ticket's top-right corner on every window but the narrowest phones,
  // where it would cover the heading, so it moves below the heading instead.
  expect(moved, `card moved below the heading at ${where}`).toBe(page.viewportSize()!.width < 375);

  expect(card.x + card.width / 2, `card on the right at ${where}`).toBeGreaterThan(
    ticket.x + ticket.width / 2,
  );
  if (!moved) {
    // Hanging on the corner: at the ticket's top, reaching past its right edge.
    expect(right(card), `card reaches past the ticket at ${where}`).toBeGreaterThan(right(ticket));
    expect(Math.abs(card.y - ticket.y), `card at the ticket's top at ${where}`).toBeLessThan(24);
  }

  // The clip sits on the card's right half and pokes above it.
  expect(clip.x + clip.width / 2, `clip on the card's right half at ${where}`).toBeGreaterThan(
    card.x + card.width / 2,
  );
  expect(clip.y, `clip above the card at ${where}`).toBeLessThan(card.y);

  // "Your order", the clip and the ticket's right hole never overlap the card or each other.
  if (!moved) {
    expect(right(words), `heading clear of the card at ${where}`).toBeLessThanOrEqual(card.x + 1);
  }
  const overlaps = (a: Box, b: Box) =>
    a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
  expect(overlaps(words, clip), `heading clear of the clip at ${where}`).toBe(false);
  expect(right(hole), `hole clear of the card at ${where}`).toBeLessThanOrEqual(card.x);
  await expectNoOverflow(page, 'main.ticket h1, .order-for h2, .order-for label');

  // Every control on the card is inside the window and big enough to tap.
  const controls = page.locator('.order-for input, .order-for button');
  for (let i = 0; i < (await controls.count()); i++) {
    const c = controls.nth(i);
    const b = (await c.boundingBox())!;
    expectInsideWidth(page, b, `card control ${i}`);
    expect(b.height, `card control ${i} height at ${where}`).toBeGreaterThanOrEqual(40);
  }

  // Button labels ("Log in", "Sign up") stay on one line.
  const wrapped = await page.locator('.order-for button').evaluateAll((buttons) =>
    buttons
      .filter((b) => (b.textContent ?? '').trim())
      .filter((b) => {
        const range = document.createRange();
        range.selectNodeContents(b);
        return range.getClientRects().length > 1;
      })
      .map((b) => b.textContent!.trim()),
  );
  expect(wrapped, `button labels on one line at ${where}`).toEqual([]);
  await expectNoOverflow(page, '.order-for button');
}

test('the Order for card hangs on the ticket corner without being cut off, logged out', async ({
  page,
}, info) => {
  for (const size of sizesFor(info.project.name)) {
    if (size) await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expectCardLayout(page);
  }
});

test('the Order for card hangs on the ticket corner without being cut off, logged in', async ({
  page,
}, info) => {
  await page.goto('/');
  await logIn(page);
  for (const size of sizesFor(info.project.name)) {
    if (size) await page.setViewportSize(size);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Display name' })).toBeVisible();
    await expectCardLayout(page);
  }
});

// --- Room menu ----------------------------------------------------------------------------

const members = (myRole: 'host' | 'guest') =>
  [
    { id: 'h', name: 'Mocha Otter', role: 'host', joinedAt: 1 },
    { id: 'c', name: 'Chai Finch', role: 'cohost', joinedAt: 2 },
    { id: 'me', name: 'Vanilla Hare', role: myRole === 'host' ? 'host' : 'guest', joinedAt: 3 },
  ].map((m) => (myRole === 'host' && m.id === 'h' ? { ...m, role: 'guest' } : m));

async function borders(page: Page) {
  return page.evaluate(() => {
    const style = (e: Element) => getComputedStyle(e);
    const mine = document.querySelector('.menu .mine')!;
    return {
      members: [...document.querySelectorAll('.menu .member')].map((e) => style(e).borderTopStyle),
      rooms: [...document.querySelectorAll('.menu .room')].map((e) => style(e).borderTopStyle),
      mineBottom: style(mine).borderBottomStyle,
    };
  });
}

test('the room menu: dotted lines between people, a solid line before Brewing now', async ({
  page,
}, info) => {
  // As host, in a running room of three, with two other rooms brewing.
  await fakeEvents(page, {
    id: 'mine',
    settings,
    timer: timer(),
    timerRev: 1,
    members: members('host'),
  });
  for (const size of sizesFor(info.project.name)) {
    if (size) await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('timer')).toBeVisible();
    await page.getByRole('button', { name: /Other timers/ }).click();
    const menu = page.getByRole('region', { name: 'Other timers' });
    await expect(menu.getByText('Brewing now')).toBeVisible();
    await expect(menu.getByText('Hazel Newt')).toBeVisible();

    expect(await borders(page)).toEqual({
      members: ['none', 'dotted', 'dotted'],
      rooms: ['none', 'solid'],
      mineBottom: 'solid',
    });
    // The solid line is under the last person when there is no Leave button.
    const mine = await boxOf(page, '.menu .mine');
    const last = await boxOf(page, '.menu .member >> nth=-1');
    expect(bottom(last)).toBeLessThanOrEqual(bottom(mine));
    await expect(menu.getByRole('button', { name: 'Leave' })).toHaveCount(0);

    await expectNoSideScroll(page);
    expectInsideWidth(page, await boxOf(page, '.menu'), 'menu');
    await expectNoOverflow(page, '.menu .name, .menu .line, .menu h2');
  }
});

test('the room menu as a guest: the solid line sits under Leave', async ({ page }, info) => {
  test.skip(
    info.project.name !== 'phone',
    'the guest layout differs from the host one only in Leave',
  );
  const room = { id: 'a', settings, timer: timer(), timerRev: 1, members: members('guest') };
  await fakeEvents(page);
  await page.route('**/api/rooms/a/join', (route) => route.fulfill({ json: room }));
  for (const size of sizesFor(info.project.name)) {
    if (size) await page.setViewportSize(size);
    await page.goto('/');
    await page.getByRole('button', { name: /Other timers/ }).click();
    const menu = page.getByRole('region', { name: 'Other timers' });
    if (await menu.getByRole('button', { name: 'Join' }).first().isVisible()) {
      await menu.getByRole('button', { name: 'Join' }).first().click();
    }
    await expect(page.getByRole('timer')).toBeVisible();
    if (!(await menu.isVisible())) await page.getByRole('button', { name: /Other timers/ }).click();
    const leave = menu.getByRole('button', { name: 'Leave' });
    await expect(leave).toBeVisible();

    expect((await borders(page)).mineBottom).toBe('solid');
    const mine = await boxOf(page, '.menu .mine');
    expect(bottom((await leave.boundingBox())!)).toBeLessThanOrEqual(bottom(mine));
    await expectNoSideScroll(page);
    expectInsideWidth(page, await boxOf(page, '.menu'), 'menu');
  }
});

// --- Time sizes ---------------------------------------------------------------------------

test('the countdown and wall clock fit the timer screen, above the scene', async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('cafe:clockShow', 'true'));
  for (const size of sizesFor(info.project.name)) {
    if (size) await page.setViewportSize(size);
    await page.goto('/');
    await page.getByRole('button', { name: 'Start brewing' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(page.locator('.head time')).toBeVisible();
    await expect(page.locator('.column .scene > *')).toBeVisible(); // drinks loaded

    const countdown = await boxOf(page, '[role="timer"]');
    const clock = await boxOf(page, '.head time');
    const scene = await boxOf(page, '.column .scene');
    expectInsideWidth(page, countdown, 'countdown');
    expectInsideWidth(page, clock, 'clock');
    expect(bottom(countdown), `countdown above the scene at ${label(page)}`).toBeLessThanOrEqual(
      scene.y + 1,
    );
    expect(bottom(clock), `clock above the scene at ${label(page)}`).toBeLessThanOrEqual(
      scene.y + 1,
    );
    for (const sel of ['[role="timer"]', '.head time']) {
      const px = await page
        .locator(sel)
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      expect(px, `${sel} size cap at ${label(page)}`).toBeLessThanOrEqual(500);
    }
    await expectNoSideScroll(page);
    const fits = await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    );
    expect(fits, `no scrolling at ${label(page)}`).toBe(true);

    await page.getByRole('button', { name: 'Restart' }).click();
    await page.getByRole('button', { name: 'Restart' }).click();
  }
});

test('the setup clock fills the right half up to its cap on big windows', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the setup clock shows on wide windows only');
  await page.addInitScript(() => localStorage.setItem('cafe:clockShow', 'true'));
  for (const size of [
    { width: 1280, height: 720 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    const clock = await boxOf(page, 'time.clock');
    const ticket = await boxOf(page, 'main.ticket');
    expect(clock.x, `clock clear of the ticket at ${label(page)}`).toBeGreaterThan(right(ticket));
    expectInsideWidth(page, clock, 'setup clock');
    const px = await page
      .locator('time.clock')
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(px).toBeLessThanOrEqual(500);
    if (size.width === 3840) expect(px, 'reaches the cap on a big window').toBe(500);
  }
});

// --- Settings and waiting -----------------------------------------------------------------

test('Settings fits the window with a mix being renamed and deleted', async ({ page }, info) => {
  for (const size of sizesFor(info.project.name)) {
    if (size) await page.setViewportSize(size);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeInViewport({ ratio: 1 }); // after it slides in
    expectInsideWidth(page, await boxOf(page, '[role="dialog"]'), 'Settings');
    const sideways = await dialog.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
    expect(sideways, `Settings scrolls sideways at ${label(page)}`).toBe(false);

    await dialog.getByRole('button', { name: 'Rename Rainy day' }).click();
    const rename = dialog.getByRole('textbox', { name: 'New name for Rainy day' });
    await expect(rename).toBeInViewport();
    expectInsideWidth(page, (await rename.boundingBox())!, 'rename box');
    expectInsideWidth(
      page,
      (await dialog.getByRole('button', { name: 'Save name' }).boundingBox())!,
      'Save name',
    );
    await rename.press('Escape');

    await dialog.getByRole('button', { name: 'Delete Rainy day' }).click();
    const confirm = dialog.getByText('Delete Rainy day?');
    await expect(confirm).toBeVisible();
    for (const name of ['Delete', 'Cancel']) {
      const b = dialog.getByRole('button', { name, exact: true });
      expectInsideWidth(page, (await b.boundingBox())!, name);
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expectNoSideScroll(page);
  }
});

test('the waiting screen fits the window', async ({ page }, info) => {
  const room = { id: 'a', settings, timer: null, timerRev: 2, members: members('guest') };
  await fakeEvents(page);
  await page.route('**/api/rooms/a/join', (route) => route.fulfill({ json: room }));
  await page.goto('/');
  await page.getByRole('button', { name: /Other timers/ }).click();
  await page
    .getByRole('region', { name: 'Other timers' })
    .getByRole('button', { name: 'Join' })
    .first()
    .click();
  const heading = page.getByRole('heading', { name: 'Waiting for Mocha Otter to order…' });
  await expect(heading).toBeVisible();
  for (const size of sizesFor(info.project.name)) {
    if (size) await page.setViewportSize(size);
    await expect(heading).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leave' })).toBeInViewport({ ratio: 1 });
    expectInsideWidth(page, (await heading.boundingBox())!, 'waiting heading');
    await expectNoSideScroll(page);
    const fits = await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    );
    expect(fits, `no scrolling at ${label(page)}`).toBe(true);
  }
});
