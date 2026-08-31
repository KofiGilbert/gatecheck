/* A unit that is switched off has no temperature to read, no band to judge it
   against, and nothing its fuel gauge or door number can say that matters. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const DASH = '—';

async function onCard(page, trailers) {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate((t) => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = [{ id: ycSlotDate(slot)+'_'+slot, date: ycSlotDate(slot), slot,
      loadedAt: new Date().toISOString(), count: t.length, trailers: t }];
    ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    ycModalOpen(0);
  }, trailers || [{ trailer:'LR7524', product:'FRIES' }]);
  await expect(page.locator('#ycmodal')).toBeVisible();
}
const fields = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#ycm_body .ycmbox')].map(b => ({
    label: b.querySelector('span').textContent,
    editable: !!b.querySelector('input,select'),
    text: b.lastElementChild.textContent,
  })));

test('OFF puts a dash in every box below it', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', 'OFF');
  const f = await fields(page);
  for (const label of ['Temp', 'Fuel', 'Intact (Y/N)', 'Door #']) {
    const box = f.find(x => x.label === label);
    expect(box.editable, label + ' must not still be asking to be filled').toBe(false);
    expect(box.text, label).toBe(DASH);
  }
  // the set point itself is still the officer's to change
  expect(f.find(x => x.label === 'Temp set point').editable).toBe(true);
});

test('and it is an escalation on its own', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', 'OFF');
  await expect(page.locator('#ycm_escbox')).toHaveText('Escalate');
  await expect(page.locator('#ycm_escbox')).toHaveClass(/on/);
  expect(await page.evaluate(() => ycEval(YC.rows[0]))).toEqual(['UNIT OFF']);
});

test('the dashes are recorded, not just drawn', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', 'OFF');
  expect(await page.evaluate(() => ({
    temp: YC.rows[0].temp, fuel: YC.rows[0].fuel,
    intact: YC.rows[0].intact, door: YC.rows[0].door })))
    .toEqual({ temp: DASH, fuel: DASH, intact: DASH, door: DASH });
});

test('an OFF trailer counts as checked, so the check can be filed', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', 'OFF');
  expect(await page.evaluate(() => ycRowDone(YC.rows[0]))).toBe(true);
});

test('a dash is never read as a bad reading in its own right', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', 'OFF');
  const bad = await page.evaluate(() => ycBadFields(YC.rows[0]));
  expect(bad.set, 'the set point is what is wrong').toBe(1);
  expect(bad.temp, 'not the dash under it').toBeUndefined();
  expect(bad.fuel).toBeUndefined();
});

test('changing off OFF gives the boxes back, empty', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', 'OFF');
  await page.selectOption('#ycm_set', '-10');
  const f = await fields(page);
  for (const label of ['Temp', 'Fuel', 'Intact (Y/N)', 'Door #'])
    expect(f.find(x => x.label === label).editable, label).toBe(true);
  expect(await page.evaluate(() => ({ temp: YC.rows[0].temp, fuel: YC.rows[0].fuel })))
    .toEqual({ temp: '', fuel: '' });
  expect(await page.evaluate(() => ycRowDone(YC.rows[0])), 'and must be filled in').toBe(false);
});

test('a reading already taken is not kept behind the dash', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', '-10');
  await page.fill('#ycm_temp', '-9.1');
  await page.selectOption('#ycm_set', 'OFF');
  expect(await page.evaluate(() => YC.rows[0].temp), 'the old reading is gone').toBe(DASH);
});

/* ---- the same on the sheet the officer reviews before submitting ---- */
async function onSheet(page) {
  await onCard(page);
  await page.evaluate(() => { ycModalClose(); go('yardsheet', false, YC.time); });
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
}

test('the sheet shows dashes too, not four empty boxes', async ({ page }) => {
  await onSheet(page);
  await page.evaluate(() => { ycSet(0, 'set', 'OFF', true); });
  const row = page.locator('#ycrows table tr').nth(1);
  await expect(row.locator('input, select'), 'only the trailer, product and set point')
    .toHaveCount(3);
  await expect(row).toContainText(DASH);
  await expect(page.locator('#ycb0')).toHaveText('Escalate');
});

/* ---- the handlers every input on that sheet calls ---- */
test('typing on the sheet actually records something', async ({ page }) => {
  await onSheet(page);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const cells = page.locator('#ycrows table tr').nth(1).locator('input');
  await cells.nth(0).fill('LR9999');
  await cells.nth(2).fill('34');
  expect(await page.evaluate(() => ({ t: YC.rows[0].trailer, s: YC.rows[0].set })))
    .toEqual({ t: 'LR9999', s: '34' });
  expect(errs, 'ycSet was referenced by every input and never defined').toEqual([]);
});

test('a temperature is tidied to a tenth when the officer leaves the box', async ({ page }) => {
  await onSheet(page);
  await page.evaluate(() => ycSet(0, 'set', '-10', true));
  const temp = page.locator('#ycrows table tr').nth(1).locator('input').nth(3);
  await temp.fill('-9');
  await temp.press('Tab');
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe('-9.1'.replace('.1', '.0'));
});

test('a set point typed in lower case is still a set point', async ({ page }) => {
  await onSheet(page);
  const set = page.locator('#ycrows table tr').nth(1).locator('input').nth(2);
  await set.fill('off');
  await set.press('Tab');
  expect(await page.evaluate(() => YC.rows[0].set)).toBe('OFF');
  expect(await page.evaluate(() => YC.rows[0].temp)).toBe(DASH);
});

/* ---- the filed check is the paper form, typed ---- */
async function filed(page) {
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.evaluate(() => {
    DB.yardchecks = [{ date: ycSlotDate('1000'), time:'1000', name:'Kobe', rows:[
      { trailer:'LR7524', product:'FRIES', set:'-10', temp:'-9.1', fuel:'FULL',
        intact:'Y', door:'20', escalate:[] },
      { trailer:'R25106', product:'BUNS', set:'OFF', temp:'—', fuel:'—', intact:'—',
        door:'—', escalate:['UNIT OFF'], action:'Called DC, unit restarted', escTo:'DC' },
    ]}];
    ycPersistAll(); go('block', false, '1000');
  });
  await expect(page.locator('#bkview')).toBeVisible();
}

test('the office reads the sheet that was filed, not a rebuild of it', async ({ page }) => {
  await filed(page);
  const body = page.locator('#bkview_body');
  // the same paper the officer previewed and the same image that was emailed
  await expect(body.locator('.ycpaper img')).toBeVisible();
  await expect(body.locator('table'), 'not a third version as a spreadsheet').toHaveCount(0);
  await expect(body.locator('.bkvmeta')).toContainText('Kobe');
  await expect(page.locator('#bkview .bkprint')).toBeVisible();
});

test('the picture is the drawn form, not a screenshot of the screen', async ({ page }) => {
  await filed(page);
  const src = await page.locator('#bkview_body .ycpaper img').getAttribute('src');
  expect(src.startsWith('data:image/png')).toBe(true);
});

/* ---- the word on a tile and the colour of it must agree ---- */
async function board(page, escalate) {
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.evaluate((esc) => {
    DB.yardchecks = [{ date: ycSlotDate('1000'), time:'1000', name:'Kobe', rows:[
      { trailer:'LR7524', product:'FRIES', set:'-10', temp:'-9.1', fuel:'FULL',
        intact:'Y', door:'20', escalate: esc ? ['UNIT OFF'] : [] },
      { trailer:'R25106', product:'BUNS', set:'-10', temp:'-9.0', fuel:'FULL',
        intact:'Y', door:'22', escalate: [] },
    ]}];
    ycPersistAll(); go('block'); blockRender();
  }, escalate);
  return page.locator('#bk_am .slot, #bk_pm .slot')
    .filter({ hasText: /Completed/ }).first();
}

test('a clean check is green and says Completed', async ({ page }) => {
  const tile = await board(page, false);
  await expect(tile).toHaveClass(/done/);
  await expect(tile.locator('.top')).toHaveText('Completed');
  await expect(tile.locator('.kpi')).toHaveText('2 checked');
});

test('a check with escalations stays green and counts them in the band', async ({ page }) => {
  const tile = await board(page, true);
  await expect(tile).toHaveClass(/esc/);
  // it is still a finished check, so it keeps the green of Completed; the band
  // underneath turns dark red and carries the warning. Red ON green measures
  // 1.05:1 and is invisible to everyone, which is why the band moved and not
  // the glyph's colour.
  await expect(tile.locator('.top')).toHaveText('Completed');
  await expect(tile.locator('.kpi')).toHaveText('1 of 2');
  const fill = await tile.evaluate(el => getComputedStyle(el).backgroundColor);
  const band = await tile.locator('.band').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(fill).toBe('rgb(30, 123, 79)');
  expect(band).toBe('rgb(61, 17, 19)');
});

/* ---- a temperature is figures ---- */
test('the temperature box asks for the number keyboard', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', '-10');
  await expect(page.locator('#ycm_temp')).toHaveAttribute('inputmode', 'decimal');
});

test('and so does the one on the sheet', async ({ page }) => {
  await onSheet(page);
  await page.evaluate(() => ycSet(0, 'set', '-10', true));
  const temp = page.locator('#ycrows table tr').nth(1).locator('input').nth(3);
  await expect(temp).toHaveAttribute('inputmode', 'decimal');
});

test('a set point is not, because DEF and OFF are words', async ({ page }) => {
  await onSheet(page);
  const set = page.locator('#ycrows table tr').nth(1).locator('input').nth(2);
  expect(await set.getAttribute('inputmode')).toBe(null);
});

test('an OFF trailer can be saved without a temperature to the tenth', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_set', 'OFF');
  await page.click('#ycm_save');
  await expect(page.locator('#ycmodal')).toBeHidden();
  await expect(page.locator('#ycgridwrap .ycgtile').nth(0)).toHaveClass(/esc/);
});
