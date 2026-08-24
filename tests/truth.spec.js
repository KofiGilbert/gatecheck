/* An officer may load the printed sheet before the receiving office sends it.
   When the office's copy arrives it is the one the yard works from, so it
   replaces the local one - but never silently, because the officer may
   already have been working from theirs. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const row = (date, order, o) => Object.assign({
  date, order, zone:'D', detail:'LIVE', time:'0830', in_yard:'N',
  vendor:'COCA-COLA', carrier:'CH ROBINSON', cases:900, pallets:14,
}, o || {});

const DAY = '2026-09-01';

/* the office's copy arrives through the snapshot, so seed it there */
async function officer(page, officeRows) {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer',
                          orders: officeRows || [] });
  await page.evaluate(() => go('sched'));
}
const loadLocally = (page, rows) => page.evaluate((r) => {
  stageOrders(r); schedSubmit();
}, rows);

test('an officer’s own copy is kept apart from the office’s', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001'), row(DAY, '8040002')]);
  const m = await page.evaluate(() => ({ office: DB.office.length, local: DB.local.length,
                                         orders: DB.orders.length }));
  expect(m.office, 'nothing pretends to be from the office').toBe(0);
  expect(m.local).toBe(2);
  expect(m.orders, 'but the app reads it as the schedule').toBe(2);
});

test('the officer sees their own day until the office sends one', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001')]);
  expect(await page.evaluate((d) => schedDayIsLocal(d), DAY)).toBe(true);
});

test('the office’s copy replaces it, and is not merged into it', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001'), row(DAY, '8040002'), row(DAY, '8040003')]);
  // the office sends the same day: four orders, one of the officer's missing
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched();
  }, [row(DAY,'8040001'), row(DAY,'8040002'), row(DAY,'8040009'), row(DAY,'8040010')]);
  const m = await page.evaluate((d) => ({
    orders: DB.orders.filter(o => o.date === d).map(o => o.order).sort(),
    local: DB.local.length,
  }), DAY);
  expect(m.orders, 'exactly the office copy, nothing blended in')
    .toEqual(['8040001', '8040002', '8040009', '8040010']);
  expect(m.local, 'the local copy of that day is retired').toBe(0);
});

test('the notice is one line, in the bell, not a banner in the way', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY,'8040001'), row(DAY,'8040002'), row(DAY,'8040003')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched(); ycUpdateBadge();
  }, [row(DAY,'8040001'), row(DAY,'8040002'), row(DAY,'8040009'), row(DAY,'8040010')]);
  // nothing lands on the screen the officer is working on
  await expect(page.locator('#schednotes')).toHaveCount(0);
  await expect(page.locator('#sec-sched')).not.toContainText('replaced the copy');
  // it waits in the bell
  await page.click('#notif');
  const item = page.locator('#notifpanel .npitem', { hasText: 'Schedule updated' });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Receiving office');
  await expect(item).toContainText('4 orders, was 3');
  const words = (await item.innerText()).replace(/\s+/g, ' ').trim().split(' ').length;
  expect(words, 'ten words or fewer, per the research').toBeLessThanOrEqual(10);
});

test('when only times or counts moved, it says how many', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001', { cases: 900, time: '0830' })]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); ycUpdateBadge();
  }, [row(DAY, '8040001', { cases: 1200, time: '1030' })]);
  await page.click('#notif');
  await expect(page.locator('#notifpanel .npitem', { hasText: 'Schedule updated' }))
    .toContainText('1 change');
});

test('a copy that read correctly still reports, briefly', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001'), row(DAY, '8040002')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); ycUpdateBadge();
  }, [row(DAY, '8040001'), row(DAY, '8040002')]);
  await page.click('#notif');
  await expect(page.locator('#notifpanel .npitem', { hasText: 'Schedule updated' }))
    .toContainText('no changes');
});

test('a day the office has not sent is left alone', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row('2026-09-01','8040001'), row('2026-09-05','8040050')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched();
  }, [row('2026-09-01','8040001')]);
  expect(await page.evaluate(() => DB.local.map(o => o.date))).toEqual(['2026-09-05']);
  expect(await page.evaluate(() => schedDayIsLocal('2026-09-05'))).toBe(true);
  expect(await page.evaluate(() => DB.notes.length)).toBe(1);
});

test('reading it clears it, and it stays cleared', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); ycUpdateBadge();
  }, [row(DAY, '8040001'), row(DAY, '8040002')]);
  await page.click('#notif');
  await page.locator('#notifpanel .npitem', { hasText: 'Schedule updated' }).click();
  await expect(page.locator('#sec-sched')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => typeof window.renderSched === 'function');
  expect(await page.evaluate(() => DB.notes.length)).toBe(0);
});

test('the bell counts it, so nothing has to interrupt the officer', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001')]);
  await expect(page.locator('#notif')).toBeHidden();
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); ycUpdateBadge();
  }, [row(DAY, '8040001'), row(DAY, '8040002')]);
  await expect(page.locator('#notif')).toBeVisible();
  await expect(page.locator('#notifn')).toHaveText('1');
});

test('a live snapshot never wipes what the officer loaded', async ({ page }) => {
  // this is the bug the reconciliation exists to make impossible
  await officer(page);
  await loadLocally(page, [row('2026-09-05', '8040050')]);
  await page.evaluate(() => {
    // a snapshot for a completely different day, as Firestore would deliver it
    DB.office = [{ date:'2026-09-01', order:'8040001', zone:'D', cases:1, pallets:1 }];
    schedReconcile(); schedRebuild(); persist(); renderSched();
  });
  expect(await page.evaluate(() => DB.orders.map(o => o.order).sort()))
    .toEqual(['8040001', '8040050']);
});

test('the office loading writes the team copy, not a local one', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.evaluate(() => go('sched'));
  await page.evaluate((r) => { stageOrders(r); schedSubmit(); }, [row(DAY, '8040001')]);
  const m = await page.evaluate(() => ({ local: DB.local.length,
                                         written: (window.__fb.written || []).length }));
  expect(m.local, 'the office never keeps a device-only copy').toBe(0);
  expect(m.written, 'it publishes').toBe(1);
});

test('what was loaded here survives a refresh', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001')]);
  await page.reload();
  await page.waitForFunction(() => typeof window.renderSched === 'function');
  expect(await page.evaluate(() => DB.local.map(o => o.order))).toEqual(['8040001']);
  expect(await page.evaluate(() => DB.orders.length)).toBe(1);
});

/* The tests above call the reconciliation directly. These drive the real
   Firestore snapshot handler, which is the only thing that runs in the yard. */
async function officeSends(page, rows) {
  await page.evaluate((r) => {
    window.__fb.orders = r;
    stopSync(); startSync();          // the stub re-fires onSnapshot with them
  }, rows);
  await page.waitForTimeout(120);
}

test('a real snapshot reconciles rather than overwriting', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY,'8040001'), row(DAY,'8040002'), row(DAY,'8040003')]);
  await officeSends(page, [row(DAY,'8040001'), row(DAY,'8040002'), row(DAY,'8040009')]);
  expect(await page.evaluate((d) =>
    DB.orders.filter(o => o.date === d).map(o => o.order).sort(), DAY))
    .toEqual(['8040001', '8040002', '8040009']);
  expect(await page.evaluate(() => DB.local.length), 'that day is retired').toBe(0);
  await page.click('#notif');
  await expect(page.locator('#notifpanel .npitem', { hasText: 'Schedule updated' }),
    'and the officer is told, in the bell').toHaveCount(1);
});

test('a real snapshot leaves a day the office has not sent', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row('2026-09-05','8040050')]);
  await officeSends(page, [row('2026-09-01','8040001')]);
  expect(await page.evaluate(() => DB.orders.map(o => o.order).sort()))
    .toEqual(['8040001', '8040050']);
  expect(await page.evaluate(() => DB.notes.length), 'nothing to reconcile').toBe(0);
});
