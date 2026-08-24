/* Signing in on the office iPad, and throwing away a day that came in wrong. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });

test('the email box comes back filled in with whoever used this device last', async ({ page }) => {
  await H.gotoApp(page);                            // signed out, nothing remembered
  await expect(page.locator('#lg_email')).toHaveValue('');
  await page.evaluate(() => sset('gc_lastemail', 'mbmccookreceiving@martin-brower.com'));
  await page.reload();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#lg_email')).toHaveValue('mbmccookreceiving@martin-brower.com');
});

test('the cursor starts on the password, not the address already typed', async ({ page }) => {
  await H.gotoApp(page);
  await page.evaluate(() => sset('gc_lastemail', 'mbmccookreceiving@martin-brower.com'));
  await page.reload();
  await expect(page.locator('#lg_pass')).toBeFocused();
});

test('a different officer can clear the remembered address', async ({ page }) => {
  await H.gotoApp(page);
  await page.evaluate(() => sset('gc_lastemail', 'mbmccookreceiving@martin-brower.com'));
  await page.reload();
  await expect(page.locator('#lg_notyou')).toBeVisible();
  await page.click('#lg_notyou');
  await expect(page.locator('#lg_email')).toHaveValue('');
  await expect(page.locator('#lg_email')).toBeFocused();
  expect(await page.evaluate(() => sget('gc_lastemail'))).toBe('');
});

test('nothing is offered when no one has signed in on this device', async ({ page }) => {
  await H.gotoApp(page);
  await expect(page.locator('#lg_notyou')).toBeHidden();
});

test('the password is never remembered', async ({ page }) => {
  await H.gotoApp(page);
  await page.evaluate(() => sset('gc_lastemail', 'mbmccookreceiving@martin-brower.com'));
  await page.reload();
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
