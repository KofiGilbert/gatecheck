const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* Refreshing used to show the signed-in app for a beat before the overlay
   appeared, because #login stayed hidden until Firebase reported an auth
   state (a CDN fetch plus an IndexedDB read). */

async function bootWithSlowAuth(page, opts) {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, Object.assign({ authDelay: 1200 }, opts || {}));
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.doLogin === 'function');
}

test('app shell is never visible before auth resolves', async ({ page }) => {
  await bootWithSlowAuth(page);
  const s = await page.evaluate(() => {
    const lg = document.getElementById('login');
    const r = lg.getBoundingClientRect();
    return {
      settled: !!(window.__fb && window.__fb.settled),
      display: getComputedStyle(lg).display,
      covers: r.width >= window.innerWidth && r.height >= window.innerHeight,
      checking: lg.classList.contains('gc-checking'),
      formVisibility: getComputedStyle(document.querySelector('#login .gc-form-wrap')).visibility,
      headerInert: document.querySelector('header').hasAttribute('inert'),
    };
  });
  expect(s.settled, 'auth should still be pending').toBe(false);
  expect(s.display).not.toBe('none');
  expect(s.covers, 'overlay must cover the viewport').toBe(true);
  expect(s.checking).toBe(true);
  expect(s.formVisibility, 'form must not flash before the state is known').toBe('hidden');
  expect(s.headerInert, 'app behind must be inert while checking').toBe(true);
});

test('resolving signed out reveals the form', async ({ page }) => {
  await bootWithSlowAuth(page);
  await expect(page.locator('#login .gc-form-wrap')).toBeVisible();
  await expect(page.locator('#lg_btn')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('login').classList.contains('gc-checking'))).toBe(false);
});

test('resolving signed in hides the overlay without flashing the form', async ({ page }) => {
  let formEverVisible = false;
  await bootWithSlowAuth(page, { user: { email: 'kofi@martinbrower.com' } });
  const stop = setInterval(async () => {
    try {
      if (await page.locator('#login .gc-form-wrap').isVisible()) formEverVisible = true;
    } catch (e) {}
  }, 30);
  await expect(page.locator('#login')).toBeHidden();
  clearInterval(stop);
  expect(formEverVisible, 'signed-in users must never see the login form').toBe(false);
  await expect(page.locator('#whoami')).toHaveText('kofi@martinbrower.com');
  expect(await page.evaluate(() =>
    [...document.body.children].filter(el => el.hasAttribute('inert')).length), 'inert released').toBe(0);
});
