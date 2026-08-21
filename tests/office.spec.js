const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice  = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'},  role:'officer' });

test('the login screen never asks which role you are', async ({ page }) => {
  await H.gotoApp(page);                       // signed out
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login select')).toHaveCount(0);
  await expect(page.locator('#login')).not.toContainText('Role');
  await expect(page.locator('#login')).not.toContainText('Office');
  await expect(page.locator('#login')).not.toContainText('Officer');
  // still just the two fields
  await expect(page.locator('#lg_email')).toBeVisible();
  await expect(page.locator('#lg_pass')).toBeVisible();
});

test('the account decides where you land', async ({ page }) => {
  await asOfficer(page);
  await expect(page.locator('#sec-home')).toBeVisible();
  await expect(page.locator('#sec-office')).toBeHidden();
  await expect(page.locator('#sec-home .tile', { hasText: 'Yard' })).toHaveCount(1);
});

test('the receiving office lands on its own screen', async ({ page }) => {
  await asOffice(page);
  await expect(page.locator('#sec-office')).toBeVisible();
  await expect(page.locator('#sec-home')).toBeHidden();
  await expect(page.locator('#sec-office')).toContainText('Schedule');
  await expect(page.locator('#sec-office')).toContainText('Trailer blocks');
});

test('a role cannot walk into the other role’s screens', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('yard'));
  await expect(page.locator('#sec-yard'), 'office must not reach the yard board').toBeHidden();
  await expect(page.locator('#sec-office')).toBeVisible();

  await asOfficer(page);
  await page.evaluate(() => go('block'));
  await expect(page.locator('#sec-block'), 'officer must not reach block release').toBeHidden();
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('the office releases a block and the officer is told', async ({ page }) => {
  await asOffice(page);
  await page.click('.tile[onclick*="block"]');
  await expect(page.locator('#sec-block')).toBeVisible();
  const slot = await page.evaluate(() => $('bk_slot').value);
  await page.fill('#bk_list', 'LR7524 FRIES\nR25106 FRIES\nH50117 CHICKEN');
  await page.click('button:has-text("Release to the yard")');
  await expect(page.locator('#toast')).toContainText('3 trailers');
  const rec = await page.evaluate((s) => ycSlotRecord(s), slot);
  expect(rec.count).toBe(3);
  expect(rec.trailers[0]).toEqual({ trailer:'LR7524', product:'FRIES' });
  expect(rec.loadedBy).toBe('office@martinbrower.com');
  await expect(page.locator('#bk_hist')).toContainText('3 trailers');
});

test('a released block turns the officer’s card Ready', async ({ page }) => {
  await asOfficer(page);
  const st = await page.evaluate(() => {
    const slot = ycShiftSlots()[2];
    DB.yardslots = [{ date: ycSlotDate(slot), slot, loadedAt: new Date().toISOString(),
                      count: 3, trailers: [{trailer:'LR7524',product:'FRIES'}] }];
    return ycSlotStatus(slot);
  });
  expect(st.top).toBe('Ready to start');
  expect(st.bandR ?? st.detail).toContain('3 trailers');
});

test('the released trailers are already on the officer’s sheet', async ({ page }) => {
  await asOfficer(page);
  await page.click('.tile[onclick*="yard"]');
  await page.evaluate(() => {
    const slot = ycShiftSlots()[2];
    DB.yardslots = [{ date: ycSlotDate(slot), slot, loadedAt: new Date().toISOString(), count: 3,
      trailers: [{trailer:'LR7524',product:'FRIES'},
                 {trailer:'R25106',product:'FRIES'},
                 {trailer:'H50117',product:'CHICKEN'}] }];
    renderYardSlots();
  });
  await page.click('#ycslots .slot >> nth=2');
  const rows = page.locator('#ycrows table tr');
  await expect(rows.nth(1).locator('input').first()).toHaveValue('LR7524');
  await expect(rows.nth(2).locator('input').first()).toHaveValue('R25106');
  await expect(rows.nth(3).locator('input').first()).toHaveValue('H50117');
  // products came across too, temps are the officer's to fill
  await expect(rows.nth(1).locator('input').nth(1)).toHaveValue('FRIES');
  await expect(rows.nth(1).locator('input').nth(3)).toHaveValue('');
});

test('work already typed is never overwritten by a block', async ({ page }) => {
  await asOfficer(page);
  await page.click('.tile[onclick*="yard"]');
  await page.evaluate(() => {
    const slot = ycShiftSlots()[2];
    DB.yardslots = [{ date: ycSlotDate(slot), slot, loadedAt: new Date().toISOString(), count: 1,
      trailers: [{trailer:'LR7524',product:'FRIES'}] }];
    renderYardSlots();
  });
  await page.click('#ycslots .slot >> nth=2');
  await page.evaluate(() => { YC.rows[0].temp = '-9.9'; ycSaveDraft(); });
  await page.goBack();
  await page.click('#ycslots .slot >> nth=2');          // same slot again
  await expect(page.locator('#ycrows table tr').nth(1).locator('input').nth(3)).toHaveValue('-9.9');
});

test('the trailer list parses trailer and product per line', async ({ page }) => {
  await asOffice(page);
  const r = await page.evaluate(() => blockParse(
    'LR7524 FRIES\n r25106,  fries \nH50117\tCHICKEN\n\nLR7524 DUPLICATE\n'));
  expect(r).toEqual([
    { trailer:'LR7524', product:'FRIES' },
    { trailer:'R25106', product:'FRIES' },
    { trailer:'H50117', product:'CHICKEN' },
  ]);
});
