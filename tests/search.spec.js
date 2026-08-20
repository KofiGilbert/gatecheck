const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const iso = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const TODAY = iso(new Date());

const ORDERS = [
  { date:TODAY, order:'8045467', vendor:'ARMADA HUB 1', carrier:'POPE', contact:'', zone:'F',
    detail:'DROP', time:'830', in_yard:'N', cases:1064, pallets:19, priority:'' },
  { date:TODAY, order:'8055968', vendor:'SYSCO', carrier:'WERNER', contact:'', zone:'B',
    detail:'LIVE', time:'1100', in_yard:'Y', cases:220, pallets:6, priority:'' },
];

async function signedIn(page, orders) {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' }, orders: orders || ORDERS });
  await expect(page.locator('#login')).toBeHidden();
}

/* The search box stays put. Search runs on every keystroke, so anything that
   repositioned it would move the field mid-type. */
test('typing does not move the search box', async ({ page }) => {
  await signedIn(page);
  const before = await page.locator('#q').boundingBox();
  await page.fill('#q', '8045467');
  await expect(page.locator('#results .ordercard')).toHaveCount(1);
  const after = await page.locator('#q').boundingBox();
  expect(Math.abs(after.y - before.y), 'search box moved vertically while typing').toBeLessThanOrEqual(1);
  expect(Math.abs(after.x - before.x), 'search box moved horizontally while typing').toBeLessThanOrEqual(1);
});

test('search finds an order and offers the seal form', async ({ page }) => {
  await signedIn(page);
  await page.fill('#q', '8045467');
  const card = page.locator('#results .ordercard');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('ARMADA HUB 1');
  await expect(card).toContainText('Zone F');
  await expect(card.locator('button')).toContainText('Fill Seal Verification Form');
});

test('no match tells the officer what to do', async ({ page }) => {
  await signedIn(page);
  await page.fill('#q', '9999999');
  await expect(page.locator('#results')).toContainText('No match');
});

test('with no schedule loaded it points at the Schedule tab', async ({ page }) => {
  await signedIn(page, []);
  await expect(page.locator('#results')).toContainText('No schedule loaded yet');
});
