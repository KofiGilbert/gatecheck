/* Back walks UP the tree - sub-place, section, home - the way it does in any
   app on the device. It used to record every visit chronologically, so home
   piled up in the stack and an iPad edge-swipe from home re-opened sheets the
   officer had already closed. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
const idx = (page) => page.evaluate(() => (history.state || {}).idx);
const at = (page) => page.evaluate(() =>
  [...document.querySelectorAll('section.on')].map(s => s.id.replace('sec-','')).join(','));

test('a deep flow retraces exactly: sheet, grid, board, home', async ({ page }) => {
  await asOfficer(page);
  await page.click('#sec-home .tile[onclick*="yard"]');
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = [{ id: ycSlotDate(slot)+'_'+slot, date: ycSlotDate(slot), slot,
      loadedAt:new Date().toISOString(), count:1, trailers:[{trailer:'LR1',product:'X'}] }];
    ycSlotsPersist();
  });
  await page.click('#ycslots .slot >> nth=1');
  await page.evaluate(() => ycGridReview());
  expect(await at(page)).toBe('yardsheet');
  for (const want of ['ycgrid', 'yard', 'home']) {
    await page.click('#menubtn');
    await expect(page.locator('#sec-' + want)).toBeVisible();
  }
  await expect(page.locator('#menubtn'), 'home is the top: no arrow').toBeHidden();
});

test('home is recorded once, however often it is passed through', async ({ page }) => {
  await asOfficer(page);
  await page.click('#sec-home .tile[onclick*="log"]');
  await page.click('#menubtn');                       // home again
  await page.click('#sec-home .tile[onclick*="dar"]');
  await page.click('#menubtn');                       // home again
  await page.click('#sec-home .tile[onclick*="search"]');
  await page.click('#menubtn');
  await expect(page.locator('#sec-home')).toBeVisible();
  expect(await idx(page), 'back on the base entry, not a pile of homes').toBe(0);
  // the swipe from home leaves the app instead of resurrecting old screens
  await page.goBack();
  await page.waitForTimeout(300);
  const inApp = await page.evaluate(() => !!document.getElementById('sec-home')).catch(() => false);
  expect(inApp, 'nothing of the app left to walk back into').toBe(false);
});

test('a menu hop is sideways: back goes home, not through every stop', async ({ page }) => {
  await asOfficer(page);
  await page.click('#sec-home .tile[onclick*="log"]');
  await page.evaluate(() => go('dar'));
  await page.evaluate(() => go('search'));
  expect(await idx(page), 'three sections, one level').toBe(1);
  await page.click('#menubtn');
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('closing the sheet an officer was sent straight into goes home', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    DB.office = [{ date: isoToday(), zone:'D', order:'8040001', vendor:'A', cases:9, pallets:1 }];
    schedRebuild(); persist(); renderSched();
  });
  await page.click('#sec-home .tile[onclick*="sched"]');
  await expect(page.locator('#dayview')).toBeVisible();
  await page.click('#dv_back');
  await expect(page.locator('#sec-home')).toBeVisible();
  expect(await idx(page), 'and the visit left nothing behind it').toBe(0);
});

test('a sideways hop from somewhere deep does not strand the stack', async ({ page }) => {
  await asOfficer(page);
  await page.click('#sec-home .tile[onclick*="yard"]');
  await page.evaluate(() => go('ycgrid', false, ycShiftSlots()[1]));
  expect(await idx(page)).toBe(2);
  await page.evaluate(() => go('log'));               // off the menu, from deep
  await page.waitForTimeout(300);
  expect(await idx(page), 'surfaced to one level').toBe(1);
  await page.click('#menubtn');
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('a second tap during the unwind lands where it pointed', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = [{ id: ycSlotDate(slot)+'_'+slot, date: ycSlotDate(slot), slot,
      loadedAt:new Date().toISOString(), count:1, trailers:[{trailer:'LR1',product:'X'}] }];
    ycSlotsPersist();
  });
  await page.evaluate(() => {
    go('ycgrid', false, ycShiftSlots()[1]);
    go('ycgrid');                                     // starts an async unwind
    go('ycgrid', false, ycShiftSlots()[1]);           // and taps again at once
  });
  await page.waitForTimeout(400);
  expect(await at(page)).toBe('ycgrid');
  expect(await page.evaluate(() => location.hash)).toContain('#ycgrid/');
});

test('the browser back mirrors the arrow at every step', async ({ page }) => {
  await asOfficer(page);
  await page.click('#sec-home .tile[onclick*="yard"]');
  await page.evaluate(() => go('ycgrid', false, ycShiftSlots()[1]));
  await page.goBack();
  await expect(page.locator('#sec-yard')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#sec-home')).toBeVisible();
});
