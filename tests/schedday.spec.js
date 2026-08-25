/* A schedule file often carries its day only in the file name. Loaded from
   the office's own export, every row came in with a blank date: no heading on
   the day, and last in a list that reads newest first. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');
const path = require('path');

const CSV = path.join(__dirname, 'fixtures', 'schedule_20260825.csv');

async function office(page) {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
}

test('the day comes off the file name when the rows have none', async ({ page }) => {
  await office(page);
  await page.setInputFiles('#file', CSV);
  await page.waitForFunction(() => window.SCHED_DRAFT && SCHED_DRAFT.length > 40);
  const rows = await page.evaluate(() => SCHED_DRAFT.map(r => r.date));
  expect(new Set(rows)).toEqual(new Set(['2026-08-25']));
});

test('and the loaded day carries its heading, at the top of the list',
  async ({ page }) => {
  await office(page);
  // a day already on file, so "newest first" has something to be first of
  await page.evaluate(() => {
    DB.orders = [{ date:'2026-08-18', zone:'D', order:'8000001',
                   vendor:'OLD VENDOR', cases:10, pallets:1 }];
    persist(); renderSched();
  });
  await page.setInputFiles('#file', CSV);
  await page.waitForFunction(() => window.SCHED_DRAFT && SCHED_DRAFT.length > 40);
  /* submitting sends the rows to Firestore and the yard sees them when the
     snapshot returns; that return is what is being checked here */
  await page.evaluate(() => {
    DB.office = DB.office.concat(SCHED_DRAFT);
    schedRebuild(); persist(); renderSched();
  });

  const days = await page.$$eval('#sched .dayacc', els => els.map(e => e.dataset.date));
  expect(days[0]).toBe('2026-08-25');
  const head = await page.textContent('#sched .dayacc:first-child .dbdate');
  expect(head).toContain('Tuesday, August 25, 2026');
});

test('every row of the file arrives, in the file’s own order', async ({ page }) => {
  await office(page);
  await page.setInputFiles('#file', CSV);
  await page.waitForFunction(() => window.SCHED_DRAFT && SCHED_DRAFT.length > 40);
  const got = await page.evaluate(() => SCHED_DRAFT.map(r => r.order));
  expect(got.length).toBe(44);
  expect(got[0]).toBe('8065800');            // first line of the file
  expect(got[got.length - 1]).toBe('8064575'); // last, and not the TOTAL row
  expect(got).not.toContain('');
});

test('a file that names no day falls to today, never to blank', async ({ page }) => {
  await office(page);
  await page.evaluate(() => {
    ING_SOURCE = 'schedule.csv';
    stageOrders([{ order:'8000009', zone:'D', vendor:'X', cases:1, pallets:1 }]);
  });
  const d = await page.evaluate(() => SCHED_DRAFT[0].date);
  expect(d).toBe(await page.evaluate(() => isoToday()));
});

test('a date the file does give is left alone', async ({ page }) => {
  await office(page);
  await page.evaluate(() => {
    ING_SOURCE = 'schedule_20260825.csv';
    stageOrders([{ order:'8000009', date:'2026-09-01', zone:'D', vendor:'X' }]);
  });
  expect(await page.evaluate(() => SCHED_DRAFT[0].date)).toBe('2026-09-01');
});
