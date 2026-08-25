/* What the receiving office actually sends. Their sheet is not a bare table:
   row one is the day, merged across the width; the header is under it; the
   star column has no heading at all; there is a blank row between zones and a
   totals row at the foot. They select the lot in Excel and paste it in, and
   the app answered "Nothing to load" - it had taken row one for the header,
   so every column was called "tuesday_august_25_2026". */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');
const fs = require('fs');
const path = require('path');

const TSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'excel-paste.tsv'), 'utf8');

async function paste(page, text) {
  await H.gotoApp(page, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.evaluate(() => go('sched'));
  await page.evaluate((t) => { document.getElementById('paste').value = t; importPaste(); }, text);
  await page.waitForFunction(() => window.SCHED_DRAFT !== null, null, { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(300);
}
const draft = (page) => page.evaluate(() => window.SCHED_DRAFT || []);

test('every order on the sheet arrives', async ({ page }) => {
  await paste(page, TSV);
  const d = await draft(page);
  expect(d.length).toBe(44);
  expect(await page.textContent('#toast')).toContain('44 rows');
});

test('the day comes off the title the office puts over the table', async ({ page }) => {
  await paste(page, TSV);
  const days = new Set((await draft(page)).map(r => r.date));
  expect(days).toEqual(new Set(['2026-08-25']));   // "Tuesday, August 25, 2026"
});

test('the columns land where they belong', async ({ page }) => {
  await paste(page, TSV);
  const d = await draft(page);
  expect(d[0]).toMatchObject({ zone:'D', priority:'★', detail:'LIVE', time:'630',
    in_yard:'N', order:'8065800', vendor:'GRAPHIC PACKAGING INTERNATIONAL',
    carrier:'TBROS', contact:'', cases:1570, pallets:30 });
  expect(d[1]).toMatchObject({ order:'8052671', contact:'CFA - ARMADA', cases:360, pallets:6 });
});

test('the star column has no heading, and is still read', async ({ page }) => {
  await paste(page, TSV);
  const d = await draft(page);
  expect(d.filter(r => r.priority).length, 'the stars were lost').toBe(26);
  // a DROP has no star, and that is not a missing value
  const drop = d.find(r => r.detail === 'DROP');
  expect(drop.priority).toBe('');
  expect(drop.order).toBeTruthy();
});

test('the rows keep the order of the sheet', async ({ page }) => {
  await paste(page, TSV);
  const d = await draft(page);
  expect(d[0].order).toBe('8065800');
  expect(d[14].order).toBe('8069367');    // last of the D block
  expect(d[15].order).toBe('8065705');    // first of the F block, across the blank row
  expect(d[43].order).toBe('8064575');
});

test('the blank rows between zones are not orders', async ({ page }) => {
  await paste(page, TSV);
  expect((await draft(page)).every(r => r.order)).toBe(true);
});

test('the totals row is a check, not an order', async ({ page }) => {
  await paste(page, TSV);
  const d = await draft(page);
  expect(d.some(r => r.order === '' || r.cases === 50622)).toBe(false);
  expect(await page.evaluate(() => window.SCHED_CLAIM)).toEqual({ cases:50622, pallets:939 });
  await expect(page.locator('#drafttally')).toContainText('totals match');
  await expect(page.locator('#drafttally')).toContainText('50,622');
  await expect(page.locator('#drafttally')).toHaveClass(/ok/);
});

test('and it says so when the totals do not add up', async ({ page }) => {
  // a row goes missing on the way in
  const lines = TSV.split('\n');
  await paste(page, lines.slice(0, 3).concat(lines.slice(4)).join('\n'));
  expect((await draft(page)).length).toBe(43);
  await expect(page.locator('#drafttally')).toContainText('does not add up');
  await expect(page.locator('#drafttally')).not.toHaveClass(/ok/);
});

test('a cell that wrapped to two lines is still its own column', async ({ page }) => {
  // Excel quotes a cell with a line break in it: "Zone\ns"
  await paste(page, TSV.replace('Zones\t', '"Zone\ns"\t'));
  const d = await draft(page);
  expect(d.length).toBe(44);
  expect(d[0].zone).toBe('D');
});

test('a plain table with the header on the first line still works', async ({ page }) => {
  await paste(page, 'Zones,Priority,Detail,Time,In Yard,Order Number,Vendor Name,'
    + 'Appointment Carrier,Contact Name,Open Cases,Pallets\n'
    + 'D,★,LIVE,630,N,8065800,GRAPHIC PACKAGING,TBROS,,1570,30');
  const d = await draft(page);
  expect(d.length).toBe(1);
  expect(d[0]).toMatchObject({ zone:'D', order:'8065800', cases:1570, pallets:30, priority:'★' });
});

test('a sheet with a date column of its own keeps it', async ({ page }) => {
  await paste(page, 'Date,Order Number,Vendor Name,Open Cases,Pallets\n'
    + '2026-09-01,8065800,GRAPHIC PACKAGING,1570,30');
  expect((await draft(page))[0].date).toBe('2026-09-01');
});

/* Excel copies what is on the screen, not what is in the cell, so a thousand
   arrives as "1,570". The app read that as not-a-number and stored a zero:
   every order of a thousand cases or more came in empty, and a sheet of
   50,622 cases totalled 11,332. */
test('a thousand cases is a thousand, not nothing', async ({ page }) => {
  await paste(page, TSV);
  const d = await draft(page);
  expect(d[0].cases, '"1,570" became a zero').toBe(1570);
  expect(d.filter(r => r.cases === 0).length, 'orders arrived with no cases').toBe(0);
  expect(d.reduce((a, r) => a + r.cases, 0)).toBe(50622);
  expect(d.reduce((a, r) => a + r.pallets, 0)).toBe(939);
});

test('and the sheet then agrees with itself', async ({ page }) => {
  await paste(page, TSV);
  await expect(page.locator('#drafttally')).toContainText('totals match');
  await expect(page.locator('#drafttally')).toHaveClass(/ok/);
  await expect(page.locator('#drafttally')).not.toContainText('does not add up');
});

test('the figures under the grid add up to the sheet', async ({ page }) => {
  await paste(page, TSV);
  const foot = await page.textContent('#draftgrid tr:last-child');
  expect(foot).toContain('44 orders');
  expect(foot).toContain('50,622');
  expect(foot).toContain('939');
});

test('every way of writing a number is read the same', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'o@m.com'}, role:'office' });
  const got = await page.evaluate(() => ['1,570','1570',' 1,570 ','2,010','68','',
    null, '1,053.0', '12,345,678'].map(cellNum));
  expect(got).toEqual([1570, 1570, 1570, 2010, 68, 0, 0, 1053, 12345678]);
});
