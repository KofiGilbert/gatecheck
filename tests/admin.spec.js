/* The admin panel: what the app does, rather than what is on any one screen.
   Submitting a seal verification used to email it and keep the copy on the
   officer's own phone, so the office's gate queue never saw a form that had
   been submitted - only one that had been saved. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function open(page, role, email) {
  await H.gotoApp(page, { user:{ email: email
    || (role === 'office' ? 'office@m.com' : role === 'admin' ? 'admin@m.com' : 'kofi@m.com') }, role });
  /* the account document decides the role, and it arrives after the app does */
  await page.waitForFunction((r) => window.CLOUD && CLOUD.role === r, role);
}

/* the account is the gate, not a password typed into the page */
async function signIn(page) {
  await page.evaluate(() => go('admin'));
  await expect(page.locator('#adm_body')).toBeVisible();
}
async function fillForm(page) {
  await page.evaluate(() => {
    go('form');
    $('f_po').value = '8065800';
    if ($('f_carrier')) $('f_carrier').value = 'TBROS';
  });
}
const sentToTeam = (page) => page.evaluate(
  () => (window.__fb.added || []).filter(a => a.name === 'forms').length);

test('an officer cannot open it, whatever they type', async ({ page }) => {
  await open(page, 'officer');
  await page.evaluate(() => go('admin'));
  await expect(page.locator('#adm_lock')).toBeVisible();
  await expect(page.locator('#adm_lock')).toContainText('Ask your admin');
  await expect(page.locator('#adm_body')).toBeHidden();
  // and there is no password to find, because there is no password
  expect(await page.evaluate(() => typeof ADMIN_PASS)).toBe('undefined');
});

test('the admin account opens it', async ({ page }) => {
  await open(page, 'admin', 'admin@npgsecurity.com');
  await signIn(page);
  await expect(page.locator('#adm_body')).toContainText('Where completed work goes');
  await expect(page.locator('#adm_body')).toContainText('Seal verification');
});

test('and so does the receiving office, so a site is never locked out',
  async ({ page }) => {
  await open(page, 'office');
  await signIn(page);
  await expect(page.locator('#adm_body')).toContainText('Where completed work goes');
});

test('a submitted form now reaches the office, not just an inbox', async ({ page }) => {
  await open(page, 'officer');
  await fillForm(page);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => pushForm());
  await page.waitForTimeout(400);
  expect(await sentToTeam(page), 'the gate queue never saw it').toBe(1);
});

test('and the office sees the driver in the queue', async ({ page }) => {
  await open(page, 'office');
  await page.evaluate(() => {
    DB.forms = [{ po:'8065800', carrier:'TBROS', driver:'D SMITH',
                  ts:new Date().toISOString(), datein:'', timein:'' }];
    go('queue'); renderQueue();
  });
  await expect(page.locator('#queuebody')).toContainText('8065800');
});

test('the admin can turn the email off and keep the app', async ({ page }) => {
  await open(page, 'office');
  await signIn(page);
  await page.locator('.admrow').first()
    .locator('input[data-route="email"]').uncheck();
  expect(await page.evaluate(() => admGoes('form', 'email'))).toBe(false);
  expect(await page.evaluate(() => admGoes('form', 'app'))).toBe(true);
});

test('and the other way round', async ({ page }) => {
  await open(page, 'office');
  await signIn(page);
  await page.locator('.admrow').first().locator('input[data-route="app"]').uncheck();
  expect(await page.evaluate(() => admGoes('form', 'app'))).toBe(false);
  expect(await page.evaluate(() => admGoes('form', 'email'))).toBe(true);
});

test('but a document cannot be left with nowhere to go', async ({ page }) => {
  await open(page, 'office');
  await signIn(page);
  await page.locator('.admrow').first().locator('input[data-route="email"]').uncheck();
  await page.waitForTimeout(200);
  /* it is meant to refuse, so this is a press rather than an uncheck */
  await page.locator('.admrow').first().locator('input[data-route="app"]').click();
  await expect(page.locator('#toast')).toContainText('has to go somewhere');
  expect(await page.evaluate(() => admGoes('form', 'app'))).toBe(true);
});

test('with email off, submitting still reaches the office and opens no mail',
  async ({ page }) => {
  await open(page, 'officer');
  await page.evaluate(() => {
    var s = admSettings(); s.deliver.form.email = false; admSave(s);
  });
  await fillForm(page);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { window.__mailed = 0;
    const real = window.emailData; window.emailData = function(){ window.__mailed++; }; });
  await page.evaluate(() => pushForm());
  await page.waitForTimeout(400);
  expect(await sentToTeam(page)).toBe(1);
  expect(await page.evaluate(() => window.__mailed), 'it emailed anyway').toBe(0);
});

test('with the app off, it emails and does not fill the queue', async ({ page }) => {
  await open(page, 'officer');
  await page.evaluate(() => { var s = admSettings(); s.deliver.form.app = false; admSave(s); });
  await fillForm(page);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { window.__mailed = 0;
    const real = window.emailData; window.emailData = function(){ window.__mailed++; }; });
  await page.evaluate(() => pushForm());
  await page.waitForTimeout(400);
  expect(await sentToTeam(page), 'it went to the team anyway').toBe(0);
  expect(await page.evaluate(() => window.__mailed)).toBe(1);
});

test('the addresses live here now, not on the officer’s settings screen',
  async ({ page }) => {
  await open(page, 'office');
  await page.evaluate(() => go('settings'));
  await expect(page.locator('#set_email')).toHaveCount(0);
  await expect(page.locator('#set_manager')).toHaveCount(0);
  await signIn(page);
  await expect(page.locator('#adm_email')).toBeVisible();
  await expect(page.locator('#adm_manager')).toBeVisible();
  await expect(page.locator('#adm_cc')).toBeVisible();
  await expect(page.locator('#adm_mailer')).toBeVisible();
});

test('an address set here is set for the whole team', async ({ page }) => {
  await open(page, 'office');
  await signIn(page);
  await page.fill('#adm_email', 'receiving@martin-brower.com');
  await page.locator('#adm_email').blur();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => getOfficeEmail())).toBe('receiving@martin-brower.com');
  const written = await page.evaluate(() => (window.__fb.written || []));
  expect(JSON.stringify(written)).toContain('receiving@martin-brower.com');
});

test('the rules are what actually decide, not the screen', async ({ page }) => {
  const rules = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'firestore.rules'), 'utf8');
  expect(rules).toContain("function isAdmin()");
  expect(rules).toMatch(/match \/settings\/\{id\}[\s\S]*allow write: if isAdmin\(\) \|\| isOffice\(\);/);
  // an admin runs the app, they do not walk a yard
  expect(rules).toContain("role() != 'office' && role() != 'admin'");
});

test('the queue window is the admin’s to set', async ({ page }) => {
  await open(page, 'office');
  await signIn(page);
  await page.selectOption('#adm_qhours', '4');
  expect(await page.evaluate(() => admSettings().queueHours)).toBe(4);
  expect(await page.evaluate(() => qWindowMs())).toBe(4 * 3600e3);
});
