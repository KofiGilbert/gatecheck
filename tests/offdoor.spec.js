/* A trailer with its unit off has no readings to give - the dashes are the
   record - and the sheet was refusing to go on until the dash was a
   temperature to the tenth of a degree. And a door holds one trailer: the
   same door twice on one check means one was typed against the wrong one. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const ROW = (t, over) => Object.assign({
  trailer:t, product:'FRIES', set:'-10', temp:'-10.0', type:'FROZEN',
  fuel:'1/2', intact:'Y', door:'N/A', action:'', escalate:[] }, over||{});

async function sheet(page, rows) {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate((rs) => {
    go('yard');
    ycOpenSlot(ycShiftSlots()[0]);
    YC.rows = rs; YC.name = 'Kobe';
    renderYard();
  }, rows);
}
const problems = (page) => page.evaluate(() => ycProblems());

test('an off unit is not held to the tenth of a degree', async ({ page }) => {
  await sheet(page, [ROW('57679', { set:'OFF', temp:'—', fuel:'—',
                                    intact:'—', door:'—', action:'Called shift manager' })]);
  const p = await problems(page);
  expect(p.block, 'nothing should stop an off trailer going through').toEqual([]);
  expect(p.warn.join(' ')).not.toContain('Temp empty');
  expect(p.warn.join(' ')).not.toContain('Fuel empty');
  expect(p.warn.join(' ')).not.toContain('Intact');
});

test('and it is still an escalation that needs an action taken', async ({ page }) => {
  await sheet(page, [ROW('57679', { set:'OFF', temp:'—', fuel:'—',
                                    intact:'—', door:'—', action:'' })]);
  const p = await problems(page);
  expect(p.block).toEqual([]);
  expect(p.warn.join(' ')).toContain('action taken');
});

test('a running trailer is still held to the tenth', async ({ page }) => {
  await sheet(page, [ROW('LR7435', { temp:'-12' })]);
  const p = await problems(page);
  expect(p.block.join(' ')).toContain('not to the tenth');
});

test('the same door twice stops the check', async ({ page }) => {
  await sheet(page, [ROW('2202', { intact:'N', door:'46' }),
                     ROW('9354', { intact:'N', door:'46' })]);
  const p = await problems(page);
  expect(p.block.length).toBe(1);
  expect(p.block[0]).toContain('Door 46');
  expect(p.block[0]).toContain('2202');
  expect(p.block[0]).toContain('9354');
});

test('two trailers on different doors are fine', async ({ page }) => {
  await sheet(page, [ROW('2202', { intact:'N', door:'46' }),
                     ROW('9354', { intact:'N', door:'44' })]);
  expect((await problems(page)).block).toEqual([]);
});

test('N/A is not a door, so it may repeat', async ({ page }) => {
  await sheet(page, [ROW('2202'), ROW('9354'), ROW('7479')]);
  expect((await problems(page)).block).toEqual([]);
});

test('the officer is told at the moment they type it', async ({ page }) => {
  await sheet(page, [ROW('2202', { intact:'N', door:'46' }),
                     ROW('9354', { intact:'N', door:'' })]);
  await page.evaluate(() => ycSet(1, 'door', '46', true));
  await expect(page.locator('#toast')).toContainText('Door 46 is already on 2202');
});

test('and the clashing door is marked on the sheet', async ({ page }) => {
  await sheet(page, [ROW('2202', { intact:'N', door:'46' }),
                     ROW('9354', { intact:'N', door:'46' })]);
  await expect(page.locator('#ycrows td.bad')).toHaveCount(2);
});

test('the preview refuses to open while a door is claimed twice', async ({ page }) => {
  await sheet(page, [ROW('2202', { intact:'N', door:'46' }),
                     ROW('9354', { intact:'N', door:'46' })]);
  let said = '';
  page.on('dialog', d => { said = d.message(); d.dismiss(); });
  await page.evaluate(() => ycPreview());
  await page.waitForTimeout(300);
  expect(said).toContain('Door 46');
  await expect(page.locator('#ycactions')).toBeHidden();
});

/* Things only looking at the screen turned up. */

test('typing OFF and moving on does not throw', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await sheet(page, [ROW('LR7435'), ROW('57679')]);
  await page.evaluate(() => { go('yardsheet', false, YC.time); renderYard(); });
  const box = page.locator('#ycrows tr').nth(2).locator('input').nth(2);
  await box.fill('OFF');
  await box.blur();
  await page.waitForTimeout(400);
  expect(errs, 'redrawing the sheet during a blur throws').toEqual([]);
  expect(await page.evaluate(() => YC.rows[1].set)).toBe('OFF');
  expect(await page.evaluate(() => YC.rows[1].temp)).toBe('—');
});

test('the preview draws without throwing, and says so', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await sheet(page, [ROW('LR7435', { intact:'N', door:'34', action:'' })]);
  await page.evaluate(() => { go('yardsheet', false, YC.time); renderYard(); ycPreview(); });
  await expect(page.locator('#ycpreview img')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#toast')).toContainText('save / email');
  expect(errs, 'ycactions was removed from the page years ago').toEqual([]);
});

test('the heading does not lecture about temperatures over a door clash',
  async ({ page }) => {
  await sheet(page, [ROW('2202', { intact:'N', door:'46' }),
                     ROW('9354', { intact:'N', door:'46' })]);
  let said = '';
  page.on('dialog', d => { said = d.message(); d.dismiss(); });
  await page.evaluate(() => ycPreview());
  await page.waitForTimeout(300);
  expect(said).toContain('Fix these before continuing');
  expect(said).not.toContain('tenth degree');
  expect(said).toContain('a door holds one trailer');
});

/* Submitting is the one action that must never fail quietly. It refused with a
   toast that was gone in under three seconds: a yard check the officer believed
   they had filed had not been sent, and the office waited for it. */
test('a refused submit says so, and cannot be missed', async ({ page }) => {
  await sheet(page, [ROW('2202', { intact:'N', door:'46' }),
                     ROW('9354', { intact:'N', door:'46' })]);
  let said = '';
  page.on('dialog', d => { said = d.message(); d.dismiss(); });
  await page.evaluate(() => ycSubmit());
  await page.waitForTimeout(300);
  expect(said, 'a toast is not enough for this').toContain('NOT been submitted');
  expect(said).toContain('Door 46');
  expect(said).toContain('still here');
  // and nothing was sent
  expect(await page.evaluate(() => (window.__fb.added||[]).length)).toBe(0);
  // the officer still has their work
  expect(await page.evaluate(() => YC.rows.length)).toBe(2);
});

test('a check with an off trailer does reach the office', async ({ page }) => {
  await sheet(page, [
    ROW('LR7435', { intact:'N', door:'34' }),
    ROW('57679', { set:'OFF', temp:'—', fuel:'—', intact:'—', door:'—' }),
    ROW('2202', { product:'COOKIES', intact:'N', door:'42' }),
  ]);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => ycSubmit());
  await page.waitForTimeout(500);
  const sent = await page.evaluate(() => (window.__fb.added||[]).filter(a => a.name === 'yardchecks'));
  expect(sent.length, 'the office never got it').toBe(1);
  expect(sent[0].data.rows.length).toBe(3);
  expect(sent[0].data.ts, 'the office lists by ts; without one it is invisible').toBeTruthy();
});
