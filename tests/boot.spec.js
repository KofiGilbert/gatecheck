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

test('overlay element exists before the app shell does', async ({ page }) => {
  // #login used to sit near the end of <body>, so during HTML parsing there was a
  // frame where <header> existed and the overlay did not.
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { authDelay: 1200 });
  await page.goto('/index.html', { waitUntil: 'commit' });
  const order = await page.evaluate(() => {
    const kids = [...document.body.children].map(e => e.id || e.tagName.toLowerCase());
    return { login: kids.indexOf('login'), header: kids.indexOf('header') };
  });
  expect(order.login, '#login must be present').toBeGreaterThanOrEqual(0);
  expect(order.login, '#login must be parsed before <header>').toBeLessThan(order.header);
});

test('app shell is never visible before auth resolves', async ({ page }) => {
  await bootWithSlowAuth(page);
  const s = await page.evaluate(() => {
    const lg = document.getElementById('login');
    const r = lg.getBoundingClientRect();
    return {
      settled: !!(window.__fb && window.__fb.settled),
      display: getComputedStyle(lg).display,
      opacity: parseFloat(getComputedStyle(lg).opacity),
      covers: r.width >= window.innerWidth && r.height >= window.innerHeight,
      checking: lg.classList.contains('gc-checking'),
      formVisibility: getComputedStyle(document.querySelector('#login .gc-form-wrap')).visibility,
      headerInert: document.querySelector('header').hasAttribute('inert'),
    };
  });
  expect(s.settled, 'auth should still be pending').toBe(false);
  expect(s.display).not.toBe('none');
  // display alone is not enough: a fade-in leaves the app readable through the overlay
  expect(s.opacity, 'overlay must be fully opaque, not fading in').toBeGreaterThanOrEqual(0.99);
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
  // the signed-in identity now lives in the slide-in menu
  await expect(page.locator('#hdrmail')).toHaveText('kofi@martinbrower.com');
  expect(await page.evaluate(() =>
    [...document.body.children].filter(el => el.hasAttribute('inert')).length), 'inert released').toBe(0);
});

/* ---- a refresh while signed in must not flash the login screen ---- */

async function sampleLogin(page, opts) {
  await page.route('**/firebasejs/**',
    r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, opts);
  await page.addInitScript(() => {
    window.__samples = [];
    const tick = () => {
      const o = document.getElementById('login');
      if (o) window.__samples.push(getComputedStyle(o).display);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test('refreshing while signed in never shows the login screen', async ({ page }) => {
  // Firebase takes a beat to confirm the session; that beat used to be a flash
  await sampleLogin(page, { user:{ email:'kofi@martinbrower.com' }, authDelay: 400 });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__fb && window.__fb.settled);
  await page.waitForTimeout(100);

  await page.evaluate(() => { window.__samples = []; });
  await page.reload();
  await page.waitForFunction(() => window.__fb && window.__fb.settled);
  await page.waitForTimeout(200);

  const seen = await page.evaluate(() => window.__samples);
  expect(seen.length, 'no frames were sampled').toBeGreaterThan(10);
  expect([...new Set(seen)], 'the login screen painted during a refresh').toEqual(['none']);
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('a session that has actually ended still gets the login screen', async ({ page }) => {
  // the flag says they were signed in, but the check comes back empty
  await sampleLogin(page, { user: null, authDelay: 120 });
  await page.addInitScript(() => {
    try{ localStorage.setItem('gc_wasin', '1'); }catch(e){}
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__fb && window.__fb.settled);
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#lg_email')).toBeVisible();
});

test('signing out clears the flag, so the next visit shows the login', async ({ page }) => {
  await H.gotoApp(page, { user:{ email:'kofi@martinbrower.com' } });
  expect(await page.evaluate(() => sget('gc_wasin'))).toBe('1');
  await page.evaluate(() => doSignOut());
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => sget('gc_wasin'))).toBe('');
});
