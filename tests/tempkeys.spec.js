/* Under inputmode="decimal" an Android keyboard offers no minus at all, and
   Samsung's drops the decimal point as well: an officer on a phone could not
   write -4.0, which is nearly every reading in a frozen yard. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* These keys exist for phones, so they are pressed with a finger here. The
   first version of this file clicked them with a mouse and passed while the
   key did nothing at all on a phone: stopping the touch event to hold the
   cursor in the box cancelled the tap itself. */
test.use({ hasTouch: true });

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

/* the whole gesture, at the pace a person works: tap, type, tap, type */
test('a finger, not a mouse: the key must work on a phone', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).tap();
  await page.keyboard.type('4');
  await page.waitForTimeout(250);
  await key(page, 'decimal point').tap();
  expect(await page.evaluate(() => YC.rows[0].temp), 'the point did nothing').toBe('4.');
  await page.waitForTimeout(250);
  await page.keyboard.type('0');
  await page.waitForTimeout(250);
  await key(page, 'minus').tap();
  expect(await page.evaluate(() => YC.rows[0].temp), 'the minus did nothing').toBe('-4.0');
});

test('and the key fires once per tap, not twice', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp:'5' })]);
  await tempBox(page).tap();
  await key(page, 'minus').tap();
  expect(await page.evaluate(() => YC.rows[0].temp), 'the tap counted twice').toBe('-5');
});

test('a temperature can be written with digits alone', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).tap();
  await page.keyboard.type('40');            // only what every keyboard has
  await page.waitForTimeout(250);
  await key(page, 'minus').tap();
  await page.waitForTimeout(250);
  await key(page, 'decimal point').tap();  // goes in at the cursor
  const v = await page.evaluate(() => YC.rows[0].temp);
  console.log('typed "40", pressed minus and point ->', v);
  expect(v).toBe('-40.');
});

test('the officer can put the point where they mean it', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).tap();
  await page.keyboard.type('4');
  await page.waitForTimeout(250);
  await key(page, 'decimal point').tap();
  await page.waitForTimeout(250);
  await page.keyboard.type('0');
  await page.waitForTimeout(250);
  await key(page, 'minus').tap();
  await tempBox(page).blur();
  expect(await page.evaluate(() => YC.rows[0].temp), 'the reading -4.0').toBe('-4.0');
});

test('the minus turns it back off again', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp: '-8.3' })]);
  await tempBox(page).tap();
  await key(page, 'minus').tap();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('8.3');
  await page.waitForTimeout(250);
  await key(page, 'minus').tap();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-8.3');
});

test('one decimal point is enough', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp: '-8.3' })]);
  await tempBox(page).tap();
  await key(page, 'decimal point').tap();
  await page.waitForTimeout(250);
  await key(page, 'decimal point').tap();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-8.3');
});

test('pressing a key does not take the box away from them', async ({ page }) => {
  await sheet(page, [ROW('LR7435')]);
  await tempBox(page).tap();
  await page.keyboard.type('9');
  await page.waitForTimeout(250);
  await key(page, 'minus').tap();
  await expect(tempBox(page)).toBeFocused();
  await page.keyboard.type('1');
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
  await page.locator('#ycm_temp').tap();
  await page.keyboard.type('4');
  await page.waitForTimeout(250);
  await page.locator('.ycmbox .tkeys button[aria-label="decimal point"]').first().tap();
  await page.waitForTimeout(250);
  await page.keyboard.type('0');
  await page.waitForTimeout(250);
  await page.locator('.ycmbox .tkeys button[aria-label="minus"]').first().tap();
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-4.0');
});

/* A phone follows a finger tap with a click of its own a moment later. Acting
   on both fired the key twice, and twice on the minus is a toggle turned over
   and back - so on a real Samsung it worked sometimes and did nothing other
   times. Playwright's tap never sends that echo, so it is sent here by hand. */
const fires = (page) => page.evaluate(() => window.__fires);
async function countFrom(page) {
  await page.evaluate(() => {
    window.__fires = 0;
    if (!window.__wrapped) {
      const real = window.ycTempApply;
      window.ycTempApply = function(){ window.__fires++; return real.apply(this, arguments); };
      window.__wrapped = true;
    }
  });
}

test('one tap is one action, echo click and all', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp:'9' })]);
  await tempBox(page).tap();
  await countFrom(page);
  await key(page, 'minus').tap();
  await page.evaluate(() => document.querySelector('#ycr0 .tkeys button[aria-label="minus"]').click());
  await page.waitForTimeout(150);
  expect(await fires(page), 'the key fired twice for one tap').toBe(1);
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-9');
});

/* A press a fifth of a second behind the last is the phone echoing, not a
   person - nobody taps the same key that fast. A press at human speed counts. */
test('a second press at human speed still counts', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp:'9' })]);
  await tempBox(page).tap();
  for (const want of ['-9', '9', '-9']) {
    await key(page, 'minus').tap();
    expect(await page.evaluate(() => YC.rows[0].temp), 'a real press was swallowed').toBe(want);
    await page.waitForTimeout(250);
  }
});
