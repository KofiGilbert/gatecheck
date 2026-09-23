/* An order from a day already gone looks like any other on the search card,
   and an officer can wave it through for the wrong day. Its date stands out
   in red; today's stays plain. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const iso = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const row = (order, date) => ({ order, date, zone:'R', detail:'LIVE', priority:true, time:'1930',
  vendor:'SCHREIBER US: MONETT', carrier:'BAY & BAY', cases:900, pallets:20, in_yard:'N' });

async function find(page, q) {
  await page.evaluate(() => go('search'));
  await page.fill('#q', q);
  return page.locator('#results .ordercard .odate').first();
}

test('yesterday’s order shows its date in red', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'officer@martinbrower.com'}, orders:[row('8099531', iso(-1))] });
  const d = await find(page, '8099531');
  await expect(d).toHaveClass(/\bold\b/);
  expect(await d.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(192, 57, 43)');
  await page.screenshot({ path: process.env.SHOT || 'test-results/olddate.png' });
});

test('today’s order keeps a plain date', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'officer@martinbrower.com'}, orders:[row('8099532', iso(0))] });
  const d = await find(page, '8099532');
  await expect(d).not.toHaveClass(/\bold\b/);
  expect(await d.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});
