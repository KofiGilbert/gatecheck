const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function onForm(page) {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' } });
  await expect(page.locator('#login')).toBeHidden();
  await page.click('#sec-home .tile[onclick*="form"]');
  await expect(page.locator('#sec-form')).toBeVisible();
  /* these tests are about the seal rules, not the paging: show every page so a
     field can be reached wherever it now lives */
  await page.evaluate(() => formStepsEls().forEach(el => { el.hidden = false; }));
}

test('the not-linked hint is gone', async ({ page }) => {
  await onForm(page);
  await expect(page.locator('#sec-form')).not.toContainText('Not linked to an order');
  await expect(page.locator('#sec-form')).not.toContainText('SLIDE TANDEMS');
});

/* 1. seal mismatch */
test('a seal mismatch is flagged on screen', async ({ page }) => {
  await onForm(page);
  const warn = page.locator('#sealwarn');
  await expect(warn).toBeHidden();
  await page.fill('#f_sealtrailer', '4471');
  await expect(warn, 'must not warn until both are entered').toBeHidden();
  await page.fill('#f_sealbol', '4417');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('do not match');
  await page.fill('#f_sealbol', '4471');
  await expect(warn).toBeHidden();
});

test('seal comparison ignores case and spacing', async ({ page }) => {
  await onForm(page);
  await page.fill('#f_sealtrailer', ' ab 123 ');
  await page.fill('#f_sealbol', 'AB123');
  await expect(page.locator('#sealwarn')).toBeHidden();
});

test('the mismatch reaches the record that leaves the building', async ({ page }) => {
  await onForm(page);
  const both = await page.evaluate(() => ({
    mismatch: sealMismatch({ sealtrailer:'4471', sealbol:'4417' }),
    same:     sealMismatch({ sealtrailer:'4471', sealbol:'4471' }),
    partial:  sealMismatch({ sealtrailer:'4471', sealbol:'' }),
  }));
  expect(both.mismatch).toBe(true);
  expect(both.same).toBe(false);
  expect(both.partial).toBe(false);
  const src = await page.evaluate(() => window.drawPaper.toString());
  expect(src, 'the form image must call out a mismatch').toContain('SEAL NUMBERS DO NOT MATCH');
});

/* 2. draft survives a reload */
test('an interrupted form survives a reload', async ({ page }) => {
  await onForm(page);
  await page.fill('#f_po', '8045467');
  await page.fill('#f_trailer', 'LR7524');
  await page.fill('#f_tractor', 'T-4412');
  await page.fill('#f_carrier', 'POPE');
  await page.fill('#f_driver', 'J SMITH');
  await page.waitForTimeout(600);            // debounce
  await page.reload();
  await page.waitForFunction(() => typeof window.doLogin === 'function');
  // the reload deep-links straight back to the form, so no tile to click
  await expect(page.locator('#sec-form')).toBeVisible();
  await expect(page.locator('#f_po')).toHaveValue('8045467');
  await expect(page.locator('#f_trailer')).toHaveValue('LR7524');
  await expect(page.locator('#f_tractor')).toHaveValue('T-4412');
  await expect(page.locator('#f_carrier')).toHaveValue('POPE');
  await expect(page.locator('#f_driver')).toHaveValue('J SMITH');
});

test('a blank form is not treated as a draft', async ({ page }) => {
  await onForm(page);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => typeof window.doLogin === 'function');
  const restored = await page.evaluate(() => formDraftRestore());
  expect(restored, 'nothing worth restoring from an untouched form').toBe(false);
});

test('starting a new form clears the draft', async ({ page }) => {
  await onForm(page);
  await page.fill('#f_po', '8045467');
  await page.waitForTimeout(600);
  await page.evaluate(() => resetForm(true));   // the explicit New form action
  expect(await page.evaluate(() => sget('gc_formdraft'))).toBeFalsy();
});

/* 4. inline required marking */
test('every empty field is marked the moment the form opens', async ({ page }) => {
  await onForm(page);
  const carrier = page.locator('#f_carrier');
  // marked on arrival, not only after the officer has been past it
  await expect(carrier).toHaveClass(/miss/);
  await carrier.fill('POPE');
  await expect(carrier).not.toHaveClass(/miss/);
  // the choices and the signature count too
  await expect(page.locator('#c_sealtype')).toHaveClass(/miss/);
  await expect(page.locator('#sigwrap')).toHaveClass(/miss/);
});

test('a page with something still empty is marked on its dot', async ({ page }) => {
  await onForm(page);
  await page.evaluate(() => { formGoStep(0); markAllMissing(); });
  await expect(page.locator('#f_dots i').nth(0)).toHaveClass(/want/);
});

test('sending with gaps asks first, and names them', async ({ page }) => {
  await onForm(page);
  await page.evaluate(() => { $('f_po').value = '8055968'; formGoStep(3); });
  await page.click('#f_next');                      // Preview
  await expect(page.locator('#actions')).toBeVisible({ timeout: 15000 });
  let msg = '';
  page.once('dialog', d => { msg = d.message(); d.dismiss(); });
  await page.click('#actions button');
  await expect.poll(() => msg).toContain('still empty');
  expect(msg).toContain('Carrier Name');
  expect(msg).toContain('Driver Signature');
  // dismissed, so nothing was filed
  expect(await page.evaluate(() => DB.forms.length)).toBe(0);
});

test('PO is not marked missing when the driver has no PO', async ({ page }) => {
  await onForm(page);
  await page.selectOption('#f_pomode', 'na');
  await page.evaluate(() => markAllMissing());
  await expect(page.locator('#f_po')).not.toHaveClass(/miss/);
});

/* 5. Time In restamp */
test('Time In can be restamped to now', async ({ page }) => {
  await onForm(page);
  await page.fill('#f_timein', '0001');
  await page.click('.nowbtn');
  const v = await page.locator('#f_timein').inputValue();
  expect(v).toMatch(/^\d{4}$/);
  expect(v).not.toBe('0001');
});
