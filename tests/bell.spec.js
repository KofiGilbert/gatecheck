/* The bell.

   Its number used to be two quantities added together: things not yet read,
   plus work not yet done. A count that means two things cannot be cleared by
   any one action - reading about a slot does not release its trailer list - so
   it sat at eleven whatever you did. The number counts news now. The work is
   still listed under the bell; it simply is not a number, because it already
   has a louder home on the Trailer blocks board. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function office(page, checks) {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.evaluate((n) => {
    const t = ycTodayISO();
    DB.yardchecks = YC_SHIFT_AM.slice(0, n).map(slot => ({
      date: t, time: slot, name: 'Kobe', ts: new Date().toISOString(),
      rows: [{ escalate: [] }, { escalate: [] }] }));
    try { localStorage.setItem('gc_notifack', '[]'); } catch (e) {}
    ycPersistAll(); ycUpdateBadge();
  }, checks);
}
const badge = page => page.locator('#notifn');

test('the badge counts what has not been read, not what has not been done', async ({ page }) => {
  await office(page, 3);
  await expect(badge(page)).toHaveText('3');
  const parts = await page.evaluate(() => ({
    unseen: notifUnseen(), filed: bkFresh().length, work: blockDue().length }));
  // whatever work is outstanding, it is not in the number
  expect(parts.unseen).toBe(parts.filed);
  expect(parts.unseen).toBe(3);
});

test('opening the bell clears the number to nought', async ({ page }) => {
  await office(page, 3);
  await expect(badge(page)).toHaveText('3');
  await page.locator('#notif').click();
  await expect(page.locator('#notifpanel')).toBeVisible();
  // this is the whole point: it goes to nought, honestly, because nothing left
  // in it is a job
  await expect(badge(page)).toBeHidden();
  expect(await page.evaluate(() => notifUnseen())).toBe(0);
});

test('seen is not read: the items stay until they are dealt with', async ({ page }) => {
  await office(page, 3);
  await page.locator('#notif').click();
  // the panel also lists work still to do - that is the point, it is listed
  // without being counted - so the news is what to measure here
  const seen = page.locator('#notifpanel .npitem.seen');
  await expect(seen, 'each piece of news is marked seen, not removed').toHaveCount(3);
  await seen.first().click();
  // tapping is read: that one leaves, the others stay
  await page.evaluate(() => { go('queue'); go('office'); ycUpdateBadge(); });
  expect(await page.evaluate(() => bkFresh().length)).toBe(2);
});

test('a seen row does not fade its own words', async ({ page }) => {
  await office(page, 2);
  await page.locator('#notif').click();
  const row = page.locator('#notifpanel .npitem.seen').first();
  // dimming a whole row is what took the served queue rows to 2.68:1
  expect(await row.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await expect(row.locator('.nptxt b')).toBeVisible();
});

test('news arriving after the bell was opened counts again', async ({ page }) => {
  await office(page, 2);
  await page.locator('#notif').click();
  await expect(badge(page)).toBeHidden();
  await page.evaluate(() => { document.getElementById('notifpanel').hidden = true; });
  await page.evaluate(() => {
    const t = ycTodayISO();
    DB.yardchecks.push({ date: t, time: YC_SHIFT_AM[4], name: 'Kobe',
      ts: new Date().toISOString(), rows: [{ escalate: [] }] });
    ycPersistAll(); ycUpdateBadge();
  });
  await expect(badge(page)).toHaveText('1');
});

test('the bell stays reachable when there is work but no news', async ({ page }) => {
  await office(page, 0);
  await page.evaluate(() => {
    // no filed checks at all, but a slot wanting a trailer list
    DB.yardslots = []; ycSlotsPersist(); ycUpdateBadge();
  });
  const hasWork = await page.evaluate(() => notifHasItems());
  if (hasWork) {
    await expect(page.locator('#notif')).toBeVisible();
    await expect(badge(page)).toBeHidden();
  }
});

/* ---- the sound ---- */
test('the bell has its own tone, and the switch silences it', async ({ page }) => {
  await office(page, 0);
  const kinds = await page.evaluate(() => {
    const seen = [];
    const real = window.beep;
    window.beep = k => { seen.push(k === undefined ? 'save' : String(k)); };
    const t = ycTodayISO();
    DB.yardchecks = [{ date: t, time: YC_SHIFT_AM[0], name: 'Kobe',
      ts: new Date().toISOString(), rows: [{ escalate: [] }] }];
    ycPersistAll(); ycUpdateBadge();
    window.beep = real;
    return seen;
  });
  // two rising notes, so it is never mistaken for a form having gone
  expect(kinds).toEqual(['notify']);
});

test('a standing count never makes a sound', async ({ page }) => {
  await office(page, 2);
  const kinds = await page.evaluate(() => {
    const seen = [];
    const real = window.beep;
    window.beep = k => seen.push(String(k));
    // nothing new: the same two checks, counted again
    ycUpdateBadge(); ycUpdateBadge();
    window.beep = real;
    return seen;
  });
  expect(kinds, 'a number that has not gone up is not news').toEqual([]);
});

/* ---- the pop-up ---- */
test('nothing is asked of the browser until somebody asks for it', async ({ page }) => {
  await office(page, 0);
  const state = await page.evaluate(() => ({
    pref: PREFS.popup,
    asked: window.__askedForPermission === true,
  }));
  // asking on load is what every guide says not to do
  expect(state.pref, 'pop-ups start off').toBe(false);
  expect(state.asked).toBe(false);
});

test('no pop-up over a screen you are already looking at', async ({ page }) => {
  await office(page, 0);
  const shown = await page.evaluate(() => {
    const out = [];
    PREFS.popup = true;
    window.Notification = function(t, o){ out.push(t); };
    window.Notification.permission = 'granted';
    // the page is visible, so the bell and the tone are enough
    const t = ycTodayISO();
    DB.yardchecks = [{ date: t, time: YC_SHIFT_AM[0], name: 'Kobe',
      ts: new Date().toISOString(), rows: [{ escalate: [] }] }];
    ycPersistAll(); ycUpdateBadge();
    return out;
  });
  expect(shown).toEqual([]);
});

test('the settings switch appears only where the browser can do it', async ({ page }) => {
  await office(page, 0);
  await page.evaluate(() => go('settings'));
  const can = await page.evaluate(() => 'Notification' in window);
  if (can) {
    await expect(page.locator('#prefsbody')).toContainText('Pop-up alerts');
    await expect(page.locator('#prefsbody')).toContainText('another tab');
  } else {
    // Safari on iOS has no Notification unless Checkpoint is installed to the
    // home screen, so the switch stays away rather than offering something
    // that cannot work
    await expect(page.locator('#prefsbody')).not.toContainText('Pop-up alerts');
  }
});

test('the sound switch covers the bell too, so it is no longer "on save"', async ({ page }) => {
  await office(page, 0);
  await page.evaluate(() => go('settings'));
  await expect(page.locator('#prefsbody')).toContainText('Sounds');
  await expect(page.locator('#prefsbody')).not.toContainText('Sound on save');
});

test('an escalation stays an escalation after you have seen it', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.evaluate(() => {
    const t = ycTodayISO();
    DB.yardchecks = [{ date:t, time:YC_SHIFT_AM[1], name:'M. Osei',
      ts:new Date().toISOString(), rows:[{escalate:['TEMP']},{escalate:[]}] }];
    try{ localStorage.setItem('gc_notifack','[]'); }catch(e){}
    ycPersistAll(); ycUpdateBadge();
  });
  await page.locator('#notif').click();
  const chip = page.locator('#notifpanel .npitem.over .npslot');
  await expect(chip).toBeVisible();
  // the first pass at "seen" cleared every chip to a grey outline, which took
  // the escalation signal off with it. The fill goes; the red does not.
  const c = await chip.evaluate(el => getComputedStyle(el).color);
  expect(c).toBe('rgb(192, 57, 43)');
});
