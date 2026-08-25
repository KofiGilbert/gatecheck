/* The office's file is the authority on the order of a day. Whatever the
   schedule was loaded from - a CSV, a spreadsheet, a photograph - is checked
   against that source line by line, so the rows must stand in the order the
   source had them. Re-sorting made the office read both twice. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });

/* deliberately NOT in zone or order-number order */
const CSV = [
  'Zones,Priority,Detail,Time,In Yard,Order Number,Vendor Name,Appointment Carrier,Contact Name,Open Cases,Pallets',
  'R,,LIVE,1500,N,8060003,ZULU FOODS,ROEHL,,100,2',
  'D,★,LIVE,630,N,8060001,ALPHA CO,TBROS,,1570,30',
  'F,,DROP,930,N,8060002,MID FOODS,J & L,,552,24',
  'D,,DROP,1000,N,8060000,BETA LTD,MARTEN,,68,13',
].join('\n');
const WANT = ['8060003', '8060001', '8060002', '8060000'];

async function load(page, text) {
  await asOffice(page);
  await page.evaluate((t) => { go('sched'); ingest(t); }, text || CSV);
  await expect(page.locator('#draftcard')).toBeVisible();
}

test('the draft grid stands in the file’s order, not re-sorted', async ({ page }) => {
  await load(page);
  expect(await page.evaluate(() => SCHED_DRAFT.map(r => r.order))).toEqual(WANT);
});

test('the grid on screen reads the same way down the page', async ({ page }) => {
  await load(page);
  const onScreen = await page.locator('#draftgrid table.dg input[value^="806"]')
    .evaluateAll(els => els.map(e => e.value));
  expect(onScreen).toEqual(WANT);
});

test('the printed preview keeps it too, so both can be eyeballed together',
  async ({ page }) => {
  await load(page);
  await page.click('button:has-text("Preview")');
  await expect(page.locator('#draftview')).toBeVisible();
  const printed = (await page.locator('#dfv_body').innerText())
    .match(/80\d{5}/g);
  expect(printed).toEqual(WANT);
});

test('and it survives being submitted and read back', async ({ page }) => {
  await load(page);
  await page.click('button:has-text("Preview")');
  await page.click('#draftview button:has-text("Submit to the yard")');
  const written = await page.evaluate(() => (window.__fb.written || []).map(o => o.order));
  expect(written, 'published in the file’s order').toEqual(WANT);
  // and the sequence goes with each row, so Firestore cannot shuffle them back
  const seqs = await page.evaluate(() => (window.__fb.written || []).map(o => o.seq));
  expect(seqs).toEqual([0, 1, 2, 3]);
});

test('the office reading it back sees the file’s order, whatever order it arrives in',
  async ({ page }) => {
  await asOffice(page);
  await page.evaluate((want) => {
    /* Firestore hands documents back in its own order, not ours */
    DB.orders = want.map((o, i) => ({ date:'2026-08-25', order:o, zone:'D',
      cases:1, pallets:1, seq:i })).reverse();
    persist(); renderSched();
  }, WANT);
  expect(await page.evaluate(() => DB.orders.map(o => o.order))).toEqual(WANT);
});

test('a schedule loaded before order was kept still reads sensibly', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => {
    DB.orders = [
      { date:'2026-08-25', order:'8060009', zone:'R', time:'1500', cases:1, pallets:1 },
      { date:'2026-08-25', order:'8060008', zone:'D', time:'0630', cases:1, pallets:1 },
    ];
    persist(); renderSched();
  });
  // no sequence to go on, so it falls back to zone and time rather than random
  expect(await page.evaluate(() => DB.orders.map(o => o.zone))).toEqual(['D', 'R']);
});

test('a photograph keeps the paper’s order the same way', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => {
    go('sched');
    ocrStage({ date:'2026-08-25', rows: [
      { zone:'R', order:'8060003', vendor:'ZULU', cases:1, pallets:1 },
      { zone:'D', order:'8060001', vendor:'ALPHA', cases:1, pallets:1 },
    ]});
  });
  expect(await page.evaluate(() => SCHED_DRAFT.map(r => r.order)))
    .toEqual(['8060003', '8060001']);
});
