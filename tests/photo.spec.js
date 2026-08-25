/* A photograph of the printed sheet goes into the same spreadsheet a .xlsx
   goes into, keeps the paper's running order, and says so when it plainly
   misread the page. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });

// what the reader hands over, in the order the rows sit on the paper
const PARSED = {
  date: '2026-08-24',
  rows: [
    { zone:'D', priority:'',  detail:'DROP', time:'1100', order:'8044981',
      vendor:'GENEVA STORAGE IL. USA', carrier:'J&L',         contact:'', cases:1490, pallets:20 },
    { zone:'D', priority:'*', detail:'LIVE', time:'830',  order:'8047868',
      vendor:'THE COCA-COLA COMPANY', carrier:'CH ROBINSON', contact:'', cases:890,  pallets:16 },
    { zone:'F', priority:'',  detail:'DROP', time:'700',  order:'8046871',
      vendor:'MCCAIN CA: CARBERRY',   carrier:'DAY&ROSS',    contact:'', cases:1134, pallets:21 },
  ],
  totals: { cases: 3514, pallets: 57 },
};

async function drop(page, parsed) {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate((p) => ocrStage(p), parsed || PARSED);
  await expect(page.locator('#draftcard')).toBeVisible();
}

test('a photo lands in the spreadsheet, not a screen of its own', async ({ page }) => {
  await drop(page);
  await expect(page.locator('#draftgrid table.dg')).toBeVisible();
  // the old card-by-card review screen is not what happens any more
  await expect(page.locator('#review')).toBeHidden();
  await expect(page.locator('#sec-sched')).not.toContainText('Check what the photo says');
});

test('the rows stay in the order they sit on the paper', async ({ page }) => {
  await drop(page);
  expect(await page.evaluate(() => SCHED_DRAFT.map(r => r.order)))
    .toEqual(['8044981', '8047868', '8046871']);
});

test('a spreadsheet is still sorted, because it has no paper to match', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate((rows) => stageOrders(rows), PARSED.rows.map(
    r => Object.assign({ date:'2026-08-24' }, r)));
  expect(await page.evaluate(() => SCHED_DRAFT.map(r => r.order)))
    .toEqual(['8044981', '8046871', '8047868']);
});

test('when the totals match the sheet, it says so plainly', async ({ page }) => {
  await drop(page);
  const tally = page.locator('#drafttally');
  await expect(tally).toBeVisible();
  await expect(tally).toContainText('totals match');
  await expect(tally).toContainText('3,514');
  await expect(tally).toContainText('57');
  await expect(tally).toHaveClass(/ok/);
});

test('when they do not match, it says the reader got it wrong', async ({ page }) => {
  await drop(page, Object.assign({}, PARSED, { totals: { cases: 32541, pallets: 643 } }));
  const tally = page.locator('#drafttally');
  await expect(tally).toBeVisible();
  await expect(tally).toContainText('does not add up');
  await expect(tally).toContainText('32,541');
  await expect(tally).toContainText('643');
  await expect(tally).not.toHaveClass(/ok/);
  await expect(tally, 'and says what usually causes it').toContainText('Pen marks');
});

test('correcting a row makes the totals agree again', async ({ page }) => {
  await drop(page, Object.assign({}, PARSED, { totals: { cases: 4514, pallets: 57 } }));
  await expect(page.locator('#drafttally')).toContainText('does not add up');
  // the missing thousand goes back into the first row
  await page.locator('#draftgrid table tr').filter({ has: page.locator('td input') })
    .nth(0).locator('input').nth(10).fill('2490');
  await expect(page.locator('#drafttally')).toContainText('totals match');
});

test('a spreadsheet claims no totals, so nothing is asserted about it', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate((rows) => stageOrders(rows), PARSED.rows.map(
    r => Object.assign({ date:'2026-08-24' }, r)));
  await expect(page.locator('#drafttally')).toBeHidden();
});

/* ---- the preview is the page after the spreadsheet ---- */
test('preview opens over the whole window, not under the grid', async ({ page }) => {
  await drop(page);
  await page.click('button:has-text("Preview")');
  const v = page.locator('#draftview');
  await expect(v).toBeVisible();
  await expect(page.locator('#dfv_date')).toHaveText('Monday, August 24, 2026');
  await expect(v.locator('table.prn')).toBeVisible();
  const m = await page.evaluate(() => {
    const r = document.getElementById('draftview').getBoundingClientRect();
    return { w: Math.round(r.width), vw: innerWidth, top: Math.round(r.top) };
  });
  expect(m.w, 'it fills the window edge to edge').toBe(m.vw);
  expect(m.top, 'and starts at the top of it').toBe(0);
});

test('the preview totals are the ones the office just checked', async ({ page }) => {
  await drop(page);
  await page.click('button:has-text("Preview")');
  await expect(page.locator('#dfv_body')).toContainText('3,514');
  await expect(page.locator('#dfv_body')).toContainText('57');
});

test('the preview keeps the paper order too', async ({ page }) => {
  await drop(page);
  await page.click('button:has-text("Preview")');
  const orders = await page.locator('#dfv_body table.prn tbody tr td:nth-child(5)').allInnerTexts()
    .catch(() => []);
  const text = await page.locator('#dfv_body').innerText();
  expect(text.indexOf('8044981')).toBeLessThan(text.indexOf('8047868'));
  expect(text.indexOf('8047868')).toBeLessThan(text.indexOf('8046871'));
  void orders;
});

test('back returns to the spreadsheet with the draft intact', async ({ page }) => {
  await drop(page);
  await page.click('button:has-text("Preview")');
  await page.click('#draftview .dvback');
  await expect(page.locator('#draftview')).toBeHidden();
  await expect(page.locator('#draftgrid table.dg')).toBeVisible();
  expect(await page.evaluate(() => SCHED_DRAFT.length)).toBe(3);
});

test('submitting from the preview closes it and publishes', async ({ page }) => {
  await drop(page);
  await page.click('button:has-text("Preview")');
  await page.click('#draftview button:has-text("Submit to the yard")');
  await expect(page.locator('#draftview')).toBeHidden();
  await expect(page.locator('#draftcard')).toBeHidden();
  // the office publishes to the shared schedule; the snapshot brings it back
  const written = await page.evaluate(() => window.__fb.written || []);
  expect(written.map(o => o.order)).toEqual(['8044981', '8047868', '8046871']);
});

/* ---- pen marks ---- */
test('coloured pen is lifted off the page before the reader sees it', async ({ page }) => {
  await asOffice(page);
  const out = await page.evaluate(() => {
    // three pixels: printed black, blue biro, plain paper
    const d = new Uint8ClampedArray([
      18, 18, 18, 255,       // print
      40, 62, 190, 255,      // blue ink
      246, 244, 238, 255,    // paper
    ]);
    penStrip(d, 3);
    return [[d[0],d[1],d[2]], [d[4],d[5],d[6]], [d[8],d[9],d[10]]];
  });
  expect(out[0], 'printed type must survive').toEqual([18, 18, 18]);
  expect(out[1], 'blue biro must go').toEqual([255, 255, 255]);
  expect(out[2], 'paper is left alone').toEqual([246, 244, 238]);
});

test('the totals line at the foot of the sheet is read as a total', async ({ page }) => {
  await asOffice(page);
  const t = await page.evaluate(() => {
    const lines = [
      'D DROP 1100 N 8044981 GENEVA STORAGE J&L 1490 20',
      'D LIVE 830 N 8047868 COCA-COLA CH ROBINSON 890 16',
      'F DROP 700 N 8046871 MCCAIN CARBERRY DAY&ROSS 1134 21',
      '',
      '3,514 57',
    ];
    const rows = [{cases:1490,pallets:20},{cases:890,pallets:16},{cases:1134,pallets:21}];
    return ocrTotals(lines, rows);
  });
  expect(t).toEqual({ cases: 3514, pallets: 57 });
});

test('a sheet with no totals line claims nothing rather than guessing', async ({ page }) => {
  await asOffice(page);
  const t = await page.evaluate(() => ocrTotals(
    ['D DROP 1100 N 8044981 GENEVA J&L 1490 20'], [{cases:1490,pallets:20}]));
  expect(t).toBe(null);
});
