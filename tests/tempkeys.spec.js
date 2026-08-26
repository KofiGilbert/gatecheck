/* Under inputmode="decimal" an Android keyboard offers no minus at all, and
   Samsung's drops the decimal point as well: an officer on a phone could not
   write -4.0, which is nearly every reading in a frozen yard. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const ROW = (t, over) => Object.assign({
  trailer:t, product:'FRIES', set:'-10', temp:'', type:'FROZEN',
  fuel:'1/2', intact:'Y', door:'N/A', action:'', escalate:[] }, over||{});

async function sheet(page, rows) {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate((rs) => {
    go('yard'); ycOpenSlot(ycShiftSlots()[0]); YC.rows = rs; YC.name = 'Kobe';
    go('yardsheet', false, YC.time); renderYard();
  }, rows);
}
const tempBox = (page) => page.locator('#ycr0 input[inputmode="decimal"]');
const key = (page, label) => page.locator('#ycr0 .tkeys button[aria-label="' + label + '"]');

test('a temperature can be written with digits alone', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).click();
  await tempBox(page).type('40');            // only what every keyboard has
  await key(page, 'minus').click();
  await key(page, 'decimal point').click();  // goes in at the cursor
  const v = await page.evaluate(() => YC.rows[0].temp);
  console.log('typed "40", pressed minus and point ->', v);
  expect(v).toBe('-40.');
});

test('the officer can put the point where they mean it', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).click();
  await tempBox(page).type('4');
  await key(page, 'decimal point').click();
  await tempBox(page).type('0');
  await key(page, 'minus').click();
  await tempBox(page).blur();
  expect(await page.evaluate(() => YC.rows[0].temp), 'the reading -4.0').toBe('-4.0');
});

test('the minus turns it back off again', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp: '-8.3' })]);
  await tempBox(page).click();
  await key(page, 'minus').click();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('8.3');
  await key(page, 'minus').click();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-8.3');
});

test('one decimal point is enough', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp: '-8.3' })]);
  await tempBox(page).click();
  await key(page, 'decimal point').click();
  await key(page, 'decimal point').click();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-8.3');
});

test('pressing a key does not take the box away from them', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).click();
  await tempBox(page).type('9');
  await key(page, 'minus').click();
  await expect(tempBox(page)).toBeFocused();
  await tempBox(page).type('1');
  await tempBox(page).blur();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-91.0');
});

test('a keyboard that gives a comma instead of a point is understood',
  async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).fill('-8,3');
  await tempBox(page).blur();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-8.3');
});

test('the keys stay out of the sheet until the box is being used', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  const keys = page.locator('#ycr0 .tkeys');
  expect(await keys.evaluate(e => getComputedStyle(e).opacity)).toBe('0');
  await tempBox(page).click();
  await expect.poll(() => keys.evaluate(e => getComputedStyle(e).opacity)).toBe('1');
});

test('a trailer with its unit off has no temperature box, and no keys',
  async ({ page }) => {
  await sheet(page, [ROW('57679', { set:'OFF', temp:'—', fuel:'—', intact:'—', door:'—' })]);
  await expect(page.locator('#ycr0 .tkeys')).toHaveCount(0);
});

test('the phone panel carries the keys too', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  const opened = await page.evaluate(() => {
    if (typeof ycModalOpen !== 'function') return false;
    ycModalOpen(0); return true;
  });
  test.skip(!opened, 'no per-trailer panel in this build');
  await expect(page.locator('#ycm_temp')).toBeVisible();
  await page.locator('.ycmbox .tkeys button[aria-label="minus"]').first().click();
  await page.locator('#ycm_temp').type('4');
  await page.locator('.ycmbox .tkeys button[aria-label="decimal point"]').first().click();
  await page.locator('#ycm_temp').type('0');
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-4.0');
});
