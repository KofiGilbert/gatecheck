/* Refreshing the receiving office showed frames of the officer's home first.
   It was fixed, then lost in a revert, and came back. It is asserted now, so
   the next time it is lost the suite says so instead of Kofi's screen. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const WATCH = () => {
  window.__seen = [];
  const shown = (id) => { const e = document.getElementById(id); if (!e) return false;
    const c = getComputedStyle(e);
    return c.display !== 'none' && c.visibility !== 'hidden' && e.offsetHeight > 0; };
  const tick = () => { window.__seen.push({ home: shown('sec-home'), office: shown('sec-office') });
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

test('refreshing the office never shows the officer home', async ({ page }, info) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.addInitScript(WATCH);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.waitForTimeout(600);
  const f = await page.evaluate(() => window.__seen);
  const wrong = f.filter(x => x.home).length;
  console.log(info.project.name, 'frames=' + f.length, 'officer home on', wrong, 'of them');
  expect(wrong).toBe(0);
  expect(f[f.length-1].office).toBe(true);
});

/* Every tab, after a refresh, on the screen the address asked for - the role
   is now guessed before the account arrives, so the guess has to route too. */
test('a refreshed office tab stays on that tab', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  for (const sec of ['block','queue','stats','sched','office']) {
    await page.evaluate(s => go(s), sec);
    await page.reload();
    await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
    await expect(page.locator('#sec-' + sec)).toHaveClass(/\bon\b/);
    await expect(page.locator('#sec-home')).toBeHidden();
  }
});

/* The guess is a guess. An officer signing in on an office device must get
   the officer's home, visible - the pre-paint guard comes off either way. */
test('an office device that changes hands is corrected', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  /* the device remembers the receiving office; the person signing in is a guard */
  await page.addInitScript(() => { try{ localStorage.setItem('gc_lastrole','office'); }catch(e){} });
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookofficer@martin-brower.com'}, role:'officer' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'officer');
  await expect(page.locator('#sec-home')).toBeVisible();
  await expect(page.locator('#sec-office')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.className)).not.toContain('boot-');
  expect(await page.evaluate(() => localStorage.getItem('gc_lastrole'))).toBe('officer');
});

/* Signed out, the device is nobody's: the next person to open it is not shown
   a held-back home screen on the strength of who used it last. */
test('signing out forgets the role', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.evaluate(() => firebase.auth().signOut());
  await page.waitForFunction(() => !(window.CLOUD && CLOUD.user));
  expect(await page.evaluate(() => localStorage.getItem('gc_lastrole') || '')).toBe('');
});

/* ---- and the layout must not jump either ----
   The wrong screen was fixed, then the right screen arrived at the wrong size:
   the four office tiles drew 144px wide inside a 640px main and snapped to
   334px inside 1600px once Firebase answered, every refresh. body.role-office
   is what widens main, and it was waiting for the account document while
   routing had already booted on the remembered role. */
const SIZES = () => {
  window.__sz = [];
  const tick = () => {
    const t = document.querySelector('#sec-office .tiles .tile');
    const m = document.querySelector('main');
    // only frames where the tiles are actually laid out: a width of 0 is the
    // section still hidden behind the pre-paint guard, with nothing drawn yet
    const w = t ? Math.round(t.getBoundingClientRect().width) : 0;
    if (t && m && w > 0) window.__sz.push(w + '/' + getComputedStyle(m).maxWidth);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

test('the office tiles are their real size on the first frame', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'},
    role:'office', authDelay: 250 });
  await page.addInitScript(SIZES);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.evaluate(() => go('office'));
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.waitForTimeout(600);
  const seen = [...new Set(await page.evaluate(() => window.__sz))];
  console.log(info.project.name, 'layouts seen during the refresh:', JSON.stringify(seen));
  expect(seen.length, 'the tiles must not be drawn at one size and then another')
    .toBe(1);
  expect(seen[0]).toContain('1600px');
});

test('an officer on an office device does not keep the office layout', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(() => { try{ localStorage.setItem('gc_lastrole','office'); }catch(e){} });
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookofficer@martin-brower.com'}, role:'officer' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'officer');
  // booting on the remembered role is a guess, and applyRole has to undo it
  const cls = await page.evaluate(() => document.body.className);
  expect(cls).not.toContain('role-office');
  await expect(page.locator('#sec-home')).toBeVisible();
});
