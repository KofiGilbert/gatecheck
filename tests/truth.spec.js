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

test('and it says what differed rather than swapping it in silence', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY,'8040001'), row(DAY,'8040002'), row(DAY,'8040003')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched();
  }, [row(DAY,'8040001'), row(DAY,'8040002'), row(DAY,'8040009'), row(DAY,'8040010')]);
  const note = page.locator('#schednotes .schednote');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('The receiving office has sent Tuesday, September 1, 2026');
  await expect(note).toContainText('replaced the copy loaded here');
  await expect(note, 'four not three').toContainText('4 orders, not 3');
  await expect(note, 'the two the officer never had').toContainText('8040009');
  await expect(note, 'the one the officer had that they do not').toContainText('8040003');
});

test('a changed time or count is called out too', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001', { cases: 900, time: '0830' })]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched();
  }, [row(DAY, '8040001', { cases: 1200, time: '1030' })]);
  await expect(page.locator('#schednotes .schednote'))
    .toContainText('1 with different times or counts');
});

test('a copy that read correctly says so, and does not alarm anyone', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001'), row(DAY, '8040002')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched();
  }, [row(DAY, '8040001'), row(DAY, '8040002')]);
  const note = page.locator('#schednotes .schednote');
  await expect(note).toContainText('It matches what was loaded here');
  await expect(note).not.toContainText('not on');
});

test('a day the office has not sent is left alone', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row('2026-09-01','8040001'), row('2026-09-05','8040050')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched();
  }, [row('2026-09-01','8040001')]);
  expect(await page.evaluate(() => DB.local.map(o => o.date))).toEqual(['2026-09-05']);
  expect(await page.evaluate(() => schedDayIsLocal('2026-09-05'))).toBe(true);
  await expect(page.locator('#schednotes .schednote')).toHaveCount(1);
});

test('the notice can be read and put away', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row(DAY, '8040001')]);
  await page.evaluate((rows) => {
    DB.office = rows; schedReconcile(); schedRebuild(); persist(); renderSched();
  }, [row(DAY, '8040001'), row(DAY, '8040002')]);
  await expect(page.locator('#schednotes .schednote')).toHaveCount(1);
  await page.click('#schednotes .snx');
  await expect(page.locator('#schednotes .schednote')).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => typeof window.renderSched === 'function');
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#schednotes .schednote'), 'and stays away').toHaveCount(0);
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
  const note = page.locator('#schednotes .schednote');
  await expect(note, 'and the officer is told').toHaveCount(1);
  await expect(note).toContainText('8040003');
});

test('a real snapshot leaves a day the office has not sent', async ({ page }) => {
  await officer(page);
  await loadLocally(page, [row('2026-09-05','8040050')]);
  await officeSends(page, [row('2026-09-01','8040001')]);
  expect(await page.evaluate(() => DB.orders.map(o => o.order).sort()))
    .toEqual(['8040001', '8040050']);
  await expect(page.locator('#schednotes .schednote'), 'nothing to reconcile').toHaveCount(0);
});
