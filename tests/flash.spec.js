/* Refreshing the receiving office showed frames of the officer's home first.
   It was fixed, then lost in a revert, and came back. */
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

test('count the frames of the wrong app', async ({ page }, info) => {
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
  console.log(info.project.name,
    'frames=' + f.length,
    'OFFICER HOME SHOWN ON', f.filter(x => x.home).length, 'FRAMES',
    '| first five:', JSON.stringify(f.slice(0,5).map(x => (x.home?'home':'') + (x.office?'office':'') || '-')));
});
