const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const iso = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const TODAY = iso(new Date());

const ORDERS = [
  { date:TODAY, order:'8045467', vendor:'ARMADA HUB 1', carrier:'POPE', contact:'', zone:'F',
    detail:'DROP', time:'830', in_yard:'N', cases:1064, pallets:19, priority:'' },
  { date:TODAY, order:'8055968', vendor:'SYSCO', carrier:'WERNER', contact:'', zone:'B',
    detail:'LIVE', time:'1100', in_yard:'Y', cases:220, pallets:6, priority:'' },
  { date:TODAY, order:'8061234', vendor:'MARTIN FOODS', carrier:'SCHNEIDER', contact:'', zone:'C',
    detail:'LIVE', time:'1400', in_yard:'Y', cases:90, pallets:2, priority:'' },
];

async function signedIn(page, orders) {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' }, orders: orders || ORDERS });
  await expect(page.locator('#login')).toBeHidden();
  await page.waitForFunction(() => window.DB && window.DB.orders && window.DB.orders.length >= 0);
}

test('empty state shows the shift context, not "waiting"', async ({ page }) => {
  await signedIn(page);
  const results = page.locator('#results');
  await expect(results).not.toContainText('Waiting for an order number');
  const stats = page.locator('#results .es-stat b');
  await expect(stats).toHaveCount(2);
  await expect(stats.nth(0)).toHaveText('3');   // due today
  await expect(stats.nth(1)).toHaveText('2');   // in yard
  await expect(page.locator('#results .es-stat').nth(0)).toContainText('due today');
});

test('typing does not move the search box', async ({ page }) => {
  await signedIn(page);
  const before = await page.locator('#q').boundingBox();
  await page.fill('#q', '8045467');
  await expect(page.locator('#results .ordercard')).toHaveCount(1);
  const after = await page.locator('#q').boundingBox();
  expect(Math.abs(after.y - before.y), 'search box moved vertically while typing').toBeLessThanOrEqual(1);
  expect(Math.abs(after.x - before.x), 'search box moved horizontally while typing').toBeLessThanOrEqual(1);
});

test('a narrowed search is remembered and one tap brings it back', async ({ page }) => {
  await signedIn(page);
  await page.fill('#q', '8045467');
  await expect(page.locator('#results .ordercard')).toHaveCount(1);
  await page.fill('#q', '');                                  // back to the empty state
  const chip = page.locator('#results .es-chips .chip').first();
  await expect(chip).toContainText('8045467');
  await expect(chip).toContainText('ARMADA HUB 1');
  const box = await chip.boundingBox();
  expect(box.height, 'chip must be a comfortable target').toBeGreaterThanOrEqual(44);
  await chip.click();
  await expect(page.locator('#q')).toHaveValue('8045467');
  await expect(page.locator('#results .ordercard')).toHaveCount(1);
});

test('recent lookups survive a reload and are capped', async ({ page }) => {
  await signedIn(page);
  for (const n of ['8045467','8055968','8061234']) {
    await page.fill('#q', n);
    await expect(page.locator('#results .ordercard')).toHaveCount(1);
  }
  await page.reload();
  await page.waitForFunction(() => window.DB && window.DB.orders.length === 3);
  const chips = page.locator('#results .es-chips .chip');
  await expect(chips).toHaveCount(3);
  await expect(chips.first()).toContainText('8061234');       // most recent first
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gc_recent')||'[]'));
  expect(stored.length).toBeLessThanOrEqual(6);
});

test('with no schedule loaded it still points at the Schedule tab', async ({ page }) => {
  await signedIn(page, []);
  await expect(page.locator('#results')).toContainText('No schedule loaded yet');
  await expect(page.locator('#results .es-stat')).toHaveCount(0);
});
