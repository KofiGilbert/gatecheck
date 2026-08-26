/* The wrong list can go out. Releasing again replaced it, but a check released
   by mistake stayed on the board with an officer expected to walk it, and
   there was no way to take it back off. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function office(page, slots) {
  await H.gotoApp(page, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.evaluate((s) => {
    DB.yardslots = s; ycSlotsPersist(); go('block');
  }, slots || []);
  await page.waitForTimeout(200);
}
const REL = (slot) => ({ id: 'y_' + slot, slot: slot,
  loadedAt: new Date().toISOString(), loadedBy: 'office@m.com',
  trailers: [{trailer:'LR7524', product:'FRIES'}, {trailer:'R25106', product:'FRIES'}] });
/* the app works in the local day, not UTC */
const today = (page) => page.evaluate(() => ycTodayISO());

test('a released check can be taken off the board', async ({ page }) => {
  await office(page, []);
  const day = await today(page);
  await office(page, [Object.assign(REL('2000'), { date: day })]);
  await page.evaluate(() => go('block', false, '2000'));
  await page.waitForTimeout(250);
  await expect(page.locator('#bk_unrelease')).toBeVisible();
  page.on('dialog', d => d.accept());
  await page.locator('#bk_unrelease').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => DB.yardslots.length), 'still on the board').toBe(0);
  expect(await page.evaluate(() => (window.__fb.deleted||[]))).toContain('y_2000');
});

test('there is nothing to take off a slot that was never loaded', async ({ page }) => {
  await office(page, []);
  await page.evaluate(() => go('block', false, '2000'));
  await page.waitForTimeout(250);
  await expect(page.locator('#bk_unrelease')).toBeHidden();
});

test('a completed check stays on the record', async ({ page }) => {
  await office(page, []);
  const day = await today(page);
  await office(page, [Object.assign(REL('2000'), { date: day })]);
  await page.evaluate((d) => {
    DB.yardchecks = [{ date:d, time:'2000', name:'Kobe', ts:new Date().toISOString(),
      rows:[{trailer:'LR7524', product:'FRIES', set:'-10', temp:'-9.1', fuel:'1/2',
             intact:'Y', door:'N/A', action:'', escalate:[]}] }];
    ycPersistAll(); go('block', false, '2000');
  }, day);
  await page.waitForTimeout(300);
  // the completed sheet is what the office sees, not the load panel
  await expect(page.locator('#bkload')).toBeHidden();
  expect(await page.evaluate(() => DB.yardslots.length)).toBe(1);
});

test('and the officer is asked before anything goes', async ({ page }) => {
  await office(page, []);
  const day = await today(page);
  await office(page, [Object.assign(REL('2000'), { date: day })]);
  await page.evaluate(() => go('block', false, '2000'));
  await page.waitForTimeout(250);
  let said = '';
  page.on('dialog', d => { said = d.message(); d.dismiss(); });
  await page.locator('#bk_unrelease').click();
  await page.waitForTimeout(300);
  expect(said).toContain('off the board');
  expect(said).toContain('2 trailers');
  expect(await page.evaluate(() => DB.yardslots.length), 'it went anyway').toBe(1);
});
