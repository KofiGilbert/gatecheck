/* Refreshing the receiving office's app showed four frames of the officer's
   home screen first: until Firebase answers there is no role, and the app
   assumed the officer. The device remembers which app it was last signed
   into, and the account document still corrects it a moment later. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* every animation frame from first paint, with what was actually on screen */
const WATCH = () => {
  window.__seen = [];
  const shown = (id) => {
    const e = document.getElementById(id);
    if (!e) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && e.offsetHeight > 0;
  };
  const tick = () => {
    window.__seen.push({ home: shown('sec-home'), office: shown('sec-office') });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function boot(page, role, email) {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { user:{ email }, role });
  await page.addInitScript(WATCH);
  await page.goto('/index.html');
  await page.waitForFunction((r) => window.CLOUD && CLOUD.role === r, role);
  await page.waitForTimeout(300);
}
const framesOf = (page, which) => page.evaluate((w) =>
  window.__seen.filter(f => f[w]).length, which);

test('the office refreshing never sees the officer’s home', async ({ page }) => {
  await boot(page, 'office', 'office@martinbrower.com');
  expect(await page.evaluate(() => localStorage.getItem('gc_lastrole'))).toBe('office');
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.waitForTimeout(400);
  expect(await framesOf(page, 'home'), 'frames of the wrong app').toBe(0);
  expect(await framesOf(page, 'office')).toBeGreaterThan(0);
  await expect(page.locator('#sec-office')).toBeVisible();
});

test('and lands on the office screen, not by way of home', async ({ page }) => {
  await boot(page, 'office', 'office@martinbrower.com');
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  expect(await page.evaluate(() => location.hash)).toBe('#office');
});

test('an officer refreshing still gets their own home, at once', async ({ page }) => {
  await boot(page, 'officer', 'kofi@martinbrower.com');
  expect(await page.evaluate(() => localStorage.getItem('gc_lastrole'))).toBe('officer');
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'officer');
  await page.waitForTimeout(400);
  expect(await framesOf(page, 'office'), 'frames of the wrong app').toBe(0);
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('a device that changes hands is corrected, not trusted', async ({ page }) => {
  await boot(page, 'office', 'office@martinbrower.com');
  // the same iPad, now signed in by an officer
  await page.addInitScript(H.FB_STUB, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'officer');
  await expect(page.locator('#sec-home')).toBeVisible();
  await expect(page.locator('#sec-office')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('gc_lastrole'))).toBe('officer');
});

test('signing out forgets which app it was', async ({ page }) => {
  await boot(page, 'office', 'office@martinbrower.com');
  await page.evaluate(() => doSignOut());
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gc_lastrole'))).toBe('');
});

test('a fresh device shows nothing of either app before it knows', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { user:null });
  await page.goto('/index.html');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#sec-office')).toBeHidden();
});
