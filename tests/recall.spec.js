/* Signing in on the office iPad, and throwing away a day that came in wrong. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });

test('the box starts empty so the list behind it is reachable', async ({ page }) => {
  await H.gotoApp(page);
  await page.evaluate(() => sset('gc_emails', JSON.stringify(['mbmccookreceiving@martin-brower.com'])));
  await page.reload();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#lg_email'), 'filling it in would hide the list').toHaveValue('');
});

test('one saved account still opens a list when the box is tapped', async ({ page }) => {
  await H.gotoApp(page);
  await page.evaluate(() => sset('gc_emails', JSON.stringify(['mbmccookreceiving@martin-brower.com'])));
  await page.reload();
  await page.locator('#lg_email').click();
  await expect(page.locator('#lg_sugg .gc-sugg-pick')).toHaveCount(1);
  await expect(page.locator('#lg_sugg')).toContainText('mbmccookreceiving@martin-brower.com');
});

test('tapping again after picking still shows every account', async ({ page }) => {
  await H.gotoApp(page);
  await page.evaluate(() => sset('gc_emails', JSON.stringify(
    ['mbmccookreceiving@martin-brower.com', 'kofi@martinbrower.com'])));
  await page.reload();
  await page.locator('#lg_email').click();
  await page.locator('#lg_sugg .gc-sugg-pick', { hasText: 'kofi@' }).click();
  await expect(page.locator('#lg_email')).toHaveValue('kofi@martinbrower.com');
  // the address in the box must not hide the other one behind it
  await page.locator('#lg_email').click();
  await expect(page.locator('#lg_sugg .gc-sugg-pick')).toHaveCount(2);
});

test('the password is asked for every time, whoever is picked', async ({ page }) => {
  await H.gotoApp(page);
  await page.evaluate(() => sset('gc_emails', JSON.stringify(['kofi@martinbrower.com'])));
  await page.reload();
  await page.locator('#lg_email').click();
  await page.locator('#lg_sugg .gc-sugg-pick').first().click();
  await expect(page.locator('#lg_pass')).toHaveValue('');
  await expect(page.locator('#lg_pass')).toBeFocused();
});

/* ---- the box offers who has signed in here before ---- */
const KNOWN = ['mbmccookreceiving@martin-brower.com', 'kofi@martinbrower.com', 'will@npgsecurity.com'];
async function withKnown(page, list) {
  await H.gotoApp(page);
  await page.evaluate((l) => sset('gc_emails', JSON.stringify(l)), list || KNOWN);
  await page.reload();
  await expect(page.locator('#login')).toBeVisible();
}

test('tapping the email box offers every account used on this device', async ({ page }) => {
  await withKnown(page);
  await page.locator('#lg_email').fill('');
  await page.locator('#lg_email').click();
  const sugg = page.locator('#lg_sugg');
  await expect(sugg).toBeVisible();
  await expect(sugg.locator('.gc-sugg-pick')).toHaveCount(3);
  for (const e of KNOWN) await expect(sugg).toContainText(e);
});

test('picking one fills it in and moves to the password', async ({ page }) => {
  await withKnown(page);
  await page.locator('#lg_email').fill('');
  await page.locator('#lg_email').click();
  await page.locator('#lg_sugg .gc-sugg-pick', { hasText: 'will@npgsecurity.com' }).click();
  await expect(page.locator('#lg_email')).toHaveValue('will@npgsecurity.com');
  await expect(page.locator('#lg_sugg')).toBeHidden();
  await expect(page.locator('#lg_pass')).toBeFocused();
});

test('typing narrows the list rather than making you finish the address', async ({ page }) => {
  await withKnown(page);
  await page.locator('#lg_email').fill('');
  await page.locator('#lg_email').pressSequentially('mb');
  const sugg = page.locator('#lg_sugg');
  await expect(sugg.locator('.gc-sugg-pick')).toHaveCount(1);
  await expect(sugg).toContainText('mbmccookreceiving@martin-brower.com');
});

test('an address nobody here uses offers nothing', async ({ page }) => {
  await withKnown(page);
  await page.locator('#lg_email').fill('');
  await page.locator('#lg_email').pressSequentially('zzz');
  await expect(page.locator('#lg_sugg')).toBeHidden();
});

test('an account can be forgotten from the list itself', async ({ page }) => {
  await withKnown(page);
  await page.locator('#lg_email').fill('');
  await page.locator('#lg_email').click();
  const sugg = page.locator('#lg_sugg');
  await expect(sugg.locator('.gc-sugg-pick')).toHaveCount(3);   // drawn before we aim at it
  await sugg.locator('.gc-sugg-row', { hasText: 'kofi@martinbrower.com' })
    .locator('.gc-sugg-x').click();
  await expect(sugg.locator('.gc-sugg-pick')).toHaveCount(2);
  await expect(sugg).not.toContainText('kofi@martinbrower.com');
  expect(await page.evaluate(() => JSON.parse(sget('gc_emails'))))
    .toEqual(['mbmccookreceiving@martin-brower.com', 'will@npgsecurity.com']);
});

test('the old Not you link is gone, the list replaced it', async ({ page }) => {
  await withKnown(page);
  await expect(page.locator('#lg_notyou')).toHaveCount(0);
  await expect(page.locator('#login')).not.toContainText('Not you?');
});

test('signing in adds that account to the list, newest first', async ({ page }) => {
  await withKnown(page, ['kofi@martinbrower.com']);
  await page.fill('#lg_email', 'will@npgsecurity.com');
  await page.fill('#lg_pass', 'good');
  await page.click('#lg_btn');
  await expect(page.locator('#login')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(sget('gc_emails'))))
    .toEqual(['will@npgsecurity.com', 'kofi@martinbrower.com']);
});

test('the password is never remembered', async ({ page }) => {
  await withKnown(page);
  await expect(page.locator('#lg_pass')).toHaveValue('');
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(stored.toLowerCase()).not.toContain('password');
});

/* ---- throwing a day away ---- */
const DAY = (d, n) => Array.from({ length:n }, (_, i) => ({
  date:d, zone:'D', order:'804000' + (i + 10), vendor:'COCA-COLA', carrier:'CH ROBINSON',
  cases:100, pallets:4, detail:'LIVE', time:'0800'
}));

async function withTwoDays(page){
  await asOffice(page);
  await page.evaluate((rows) => { DB.orders = rows; persist(); renderSched(); go('sched'); },
    [...DAY('2026-09-01', 3), ...DAY('2026-09-02', 2)]);
  await expect(page.locator('.dayacc')).toHaveCount(2);
}

test('a loaded day can be thrown away, not only corrected', async ({ page }) => {
  await withTwoDays(page);
  const bar = page.locator('.dayacc[data-date="2026-09-01"]');
  await expect(bar.locator('.dbdel')).toBeVisible();
  page.once('dialog', d => d.accept());
  await bar.locator('.dbdel').click();
  await expect(page.locator('.dayacc')).toHaveCount(1);
  await expect(page.locator('.dayacc[data-date="2026-09-02"]')).toBeVisible();
  expect(await page.evaluate(() => DB.orders.map(o => o.date)))
    .toEqual(['2026-09-02', '2026-09-02']);
});

test('it says which day and how many orders before it goes', async ({ page }) => {
  await withTwoDays(page);
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.locator('.dayacc[data-date="2026-09-01"] .dbdel').click();
  expect(asked).toContain('September 1, 2026');
  expect(asked).toContain('3 orders');
  await expect(page.locator('.dayacc'), 'dismissing keeps the day').toHaveCount(2);
});

test('officers cannot throw a day away', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer',
    orders: DAY('2026-09-01', 3) });
  await page.evaluate(() => go('sched'));
  await expect(page.locator('.dbdel')).toHaveCount(0);
});

test('the delete icon sits beside preview and edit, not inside the day', async ({ page }) => {
  await withTwoDays(page);
  const icons = page.locator('.dayacc[data-date="2026-09-01"] .dbicons button');
  await expect(icons).toHaveCount(3);
  await expect(icons.nth(0)).toHaveAttribute('title', 'Preview');
  await expect(icons.nth(1)).toHaveAttribute('title', 'Edit');
  await expect(icons.nth(2)).toHaveAttribute('title', 'Delete this day');
});

test('the day leaves the team schedule, not just this browser', async ({ page }) => {
  await withTwoDays(page);
  page.once('dialog', d => d.accept());
  await page.locator('.dayacc[data-date="2026-09-01"] .dbdel').click();
  await expect(page.locator('.dayacc')).toHaveCount(1);
  const gone = await page.evaluate(() => window.__fb.deleted || []);
  expect(gone.sort()).toEqual(['2026-09-01_80400010', '2026-09-01_80400011', '2026-09-01_80400012']);
  expect(gone.some(id => id.startsWith('2026-09-02')), 'the other day is untouched').toBe(false);
});
