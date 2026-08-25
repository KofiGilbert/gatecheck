/* INTACT asks whether the trailer is still sealed. A trailer at a loading
   door is not - the seal is cut to open it - so the two answers are locked
   together. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });

async function onCard(page) {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = [{ id: ycSlotDate(slot)+'_'+slot, date: ycSlotDate(slot), slot,
      loadedAt: new Date().toISOString(), count: 1,
      trailers: [{ trailer:'LR7524', product:'FRIES' }] }];
    ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    ycModalOpen(0);
  });
  await expect(page.locator('#ycmodal')).toBeVisible();
}

test('choosing a door says the trailer is not sealed', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_door', '20');
  await expect(page.locator('#ycm_intact')).toHaveValue('N');
  expect(await page.evaluate(() => YC.rows[0].intact)).toBe('N');
});

test('saying it is sealed says it is not at a door', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_door', '20');
  await page.selectOption('#ycm_intact', 'Y');
  await expect(page.locator('#ycm_door')).toHaveValue('N/A');
  expect(await page.evaluate(() => YC.rows[0].door)).toBe('N/A');
});

test('saying it is not sealed asks which door', async ({ page }) => {
  await onCard(page);
  await page.selectOption('#ycm_intact', 'N');
  expect(await page.evaluate(() => ycDoorWanted(YC.rows[0]))).toBe(true);
  // the box says so rather than waiting to be discovered at the end
  await expect(page.locator('#ycm_door')).toHaveClass(/want/);
});

test('and the trailer is not finished until it says', async ({ page }) => {
  await onCard(page);
  await page.evaluate(() => {
    const r = YC.rows[0];
    r.set = '-10'; r.temp = '-9.1'; r.fuel = 'FULL'; r.intact = 'N'; r.door = 'N/A';
  });
  expect(await page.evaluate(() => ycRowDone(YC.rows[0])), 'no door named').toBe(false);
  await page.evaluate(() => { YC.rows[0].door = '20'; });
  expect(await page.evaluate(() => ycRowDone(YC.rows[0]))).toBe(true);
});

test('a sealed trailer with N/A is finished', async ({ page }) => {
  await onCard(page);
  await page.evaluate(() => {
    const r = YC.rows[0];
    r.set = '-10'; r.temp = '-9.1'; r.fuel = 'FULL'; r.intact = 'Y'; r.door = 'N/A';
  });
  expect(await page.evaluate(() => ycRowDone(YC.rows[0]))).toBe(true);
});

test('submitting warns about a trailer that says neither', async ({ page }) => {
  await onCard(page);
  const warn = await page.evaluate(() => {
    const r = YC.rows[0];
    r.set = '-10'; r.temp = '-9.1'; r.fuel = 'FULL'; r.intact = 'N'; r.door = '';
    return ycProblems().warn.join(' | ');
  });
  expect(warn).toContain('which door');
});

test('a door read off a photograph says unsealed too', async ({ page }) => {
  await asOfficer(page);
  const rows = await page.evaluate(() =>
    ycParseTrailers('LR7524 FRIES -10 -9.1 FULL 20').map(r => [r.door, r.intact]));
  expect(rows[0]).toEqual(['20', 'N']);
});

test('an unsealed trailer is not an escalation: it is a trailer at a door', async ({ page }) => {
  await onCard(page);
  const esc = await page.evaluate(() => {
    const r = YC.rows[0];
    r.set = '-10'; r.temp = '-9.1'; r.fuel = 'FULL'; r.intact = 'N'; r.door = '20';
    return ycEval(r);
  });
  expect(esc).toEqual([]);
});

test('the sheet locks the two together as well', async ({ page }) => {
  await onCard(page);
  await page.evaluate(() => { ycModalClose(); go('yardsheet', false, YC.time); });
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
  await page.evaluate(() => ycSet(0, 'door', '22', true));
  expect(await page.evaluate(() => YC.rows[0].intact)).toBe('N');
  await page.evaluate(() => ycSet(0, 'intact', 'Y', true));
  expect(await page.evaluate(() => YC.rows[0].door)).toBe('N/A');
});
