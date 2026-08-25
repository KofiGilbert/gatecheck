/* The service worker answered for the app's own code from its cache, and
   refreshed it "for next time". The first refresh after a deploy therefore
   served the new page with the previous version's JavaScript, and only the
   second put them right. It is why every deploy came with "clear Safari's
   website data", and on 25 August 2026 it cost a completed yard check. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');
const fs = require('fs');
const path = require('path');
test.use({ serviceWorkers: 'allow' });

const APP = path.join(__dirname, '..', 'js', 'app.js');
const controlled = (page) => page.evaluate(
  () => !!(navigator.serviceWorker && navigator.serviceWorker.controller));

test('one refresh is enough to get a new version', async ({ page }, info) => {
  test.setTimeout(120000);
  /* a file of its own, so this never edits the app and never races another
     browser doing the same thing */
  const NAME = 'deploytest-' + info.project.name + '.js';
  const FILE = path.join(__dirname, '..', NAME);
  fs.writeFileSync(FILE, '/* v1 */\n');
  try {
    await H.gotoApp(page, { user:{email:'k@m.com'}, role:'officer' });
    await page.waitForTimeout(2500);
    expect(await controlled(page), 'the worker never took over').toBe(true);

    // the worker caches it, exactly as it caches js/app.js
    const first = await page.evaluate(n => fetch('/' + n).then(r => r.text()), NAME);
    expect(first).toContain('v1');

    // a new version is deployed
    fs.writeFileSync(FILE, '/* v2 */\n');
    const second = await page.evaluate(n => fetch('/' + n).then(r => r.text()), NAME);
    expect(second, 'the worker served the previous version').toContain('v2');

    // and after a refresh too, which is what an officer actually does
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    fs.writeFileSync(FILE, '/* v3 */\n');
    const third = await page.evaluate(n => fetch('/' + n).then(r => r.text()), NAME);
    expect(third).toContain('v3');
  } finally {
    try { fs.unlinkSync(FILE); } catch (e) {}
  }
});

test('and the app still opens with no network at all', async ({ page, context }, info) => {
  test.setTimeout(120000);
  /* reloading a WebKit page with the network cut errors inside the browser
     itself, not the app; the shell is the same code on every engine */
  test.skip(info.project.name === 'webkit-iphone', 'WebKit cannot reload offline under test');
  await H.gotoApp(page, { user:{email:'k@m.com'}, role:'officer' });
  await page.waitForTimeout(2500);
  expect(await controlled(page)).toBe(true);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    // the shell is there: the yard is a bad place for signal
    expect(await page.evaluate(() => typeof window.go)).toBe('function');
    await expect(page.locator('#sec-home .tile').first()).toBeVisible();
    expect(await page.locator('#sec-home .tile').count()).toBe(6);
  } finally {
    await context.setOffline(false);
  }
});

test('the cache is named for this version, so the old one is cleared',
  async ({ page }) => {
  await H.gotoApp(page, { user:{email:'k@m.com'}, role:'officer' });
  await page.waitForTimeout(2500);
  const names = await page.evaluate(() => caches.keys());
  expect(names.length, 'an old cache was left behind').toBe(1);
  expect(names[0]).toBe('checkpoint-shell-v5');
});

test('it still keeps out of the way of Firebase', async ({ page }) => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  expect(sw).toContain('googleapis|gstatic|firebase');
  expect(sw).toContain('jsdelivr|huggingface');
});
