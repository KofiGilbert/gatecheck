/* Rows loaded before Checkpoint read the day off the file name are already
   stored with no date at all. They print no heading, they sit last in a list
   that reads newest first, and the yard never sees them, because the yard
   asks for today. Fixing new uploads did nothing for those. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const DATED = [
  { date:'2026-08-24', zone:'D', order:'8000024', vendor:'A CO', cases:100, pallets:2, seq:0 },
  { date:'2026-08-18', zone:'D', order:'8000018', vendor:'B CO', cases:200, pallets:3, seq:0 },
];
/* the shape prod is in: the office's own export, which has no date column */
const UNDATED = ['8065800', '8052671', '8056594'].map((order, i) => (
  { date:'', zone:'D', order, vendor:'GRAPHIC PACKAGING', carrier:'TBROS',
    time:'630', cases:1570, pallets:30, seq:i }));

async function open(page, role, email) {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB,
    { user:{ email }, role, orders: DATED.concat(UNDATED) });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.user);
  await page.waitForFunction(() => DB.office.length > 0);
  await page.evaluate(() => go('sched'));
}

test('a day with no date is given one, and stops sitting last', async ({ page }) => {
  await open(page, 'office', 'mbmccookreceiving@martin-brower.com');
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  const days = await page.$$eval('#sched .dayacc', els => els.map(e => e.dataset.date));
  expect(days).not.toContain('');
  expect(days[0]).toBe(await page.evaluate(() => isoToday()));
});

test('and it carries a heading like every other day', async ({ page }) => {
  await open(page, 'office', 'mbmccookreceiving@martin-brower.com');
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  const heads = await page.$$eval('#sched .dbdate', els => els.map(e => e.textContent.trim()));
  expect(heads.filter(h => !h)).toEqual([]);
  expect(heads[0]).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}$/);
});

test('the rows keep the order of the file they came from', async ({ page }) => {
  await open(page, 'office', 'mbmccookreceiving@martin-brower.com');
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  const today = await page.evaluate(() => isoToday());
  const got = await page.evaluate((d) =>
    DB.orders.filter(o => o.date === d).map(o => o.order), today);
  expect(got).toEqual(['8065800', '8052671', '8056594']);
});

test('the office writes the day back, so every device sees it', async ({ page }) => {
  await open(page, 'office', 'mbmccookreceiving@martin-brower.com');
  await page.waitForFunction(() => (window.__fb.written || []).length >= 3);
  const today = await page.evaluate(() => isoToday());
  const written = await page.evaluate(() => window.__fb.written);
  expect(written.map(w => w.order).sort())
    .toEqual(['8052671', '8056594', '8065800']);
  written.forEach(w => expect(w.date).toBe(today));
  // the old undated documents are named "_<order>" and have to go
  const gone = await page.evaluate(() => window.__fb.deleted || []);
  expect(gone.sort()).toEqual(['_8052671', '_8056594', '_8065800']);
});

test('the yard sees them, because the yard asks for today', async ({ page }) => {
  await open(page, 'officer', 'kofi@martinbrower.com');
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  await expect(page.locator('#schednone')).toBeHidden();
  expect(await page.textContent('#cnt')).toContain('3');
  /* an officer lands straight on today's sheet, with no bars to pick through */
  await expect(page.locator('#dayview table.prn')).toBeVisible();
  await expect(page.locator('#dayview')).toContainText('GRAPHIC PACKAGING');
  await expect(page.locator('#dayview table.prn tr.tot')).toContainText('3 orders');
  expect(await page.evaluate(() => location.hash))
    .toBe('#sched/' + await page.evaluate(() => isoToday()) + '/preview');
});

test('an officer repairs their own copy but does not write for the team',
  async ({ page }) => {
  await open(page, 'officer', 'kofi@martinbrower.com');
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  expect(await page.evaluate(() => (window.__fb.written || []).length)).toBe(0);
});

test('days that already have a date are left exactly as they were',
  async ({ page }) => {
  await open(page, 'office', 'mbmccookreceiving@martin-brower.com');
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  const kept = await page.evaluate(() =>
    DB.orders.filter(o => o.order === '8000024' || o.order === '8000018')
             .map(o => o.date).sort());
  expect(kept).toEqual(['2026-08-18', '2026-08-24']);
});

/* When those rows were loaded is not in the row, but Firestore stamps every
   document with the time it was created, and that is the day the sheet was
   loaded. Stamping whatever day the app happens to be opened would file a
   Tuesday sheet under Thursday. */
const REST = '**/firestore.googleapis.com/**';
const LOADED = '2026-08-20T19:15:00.000000Z';   // an evening here, tomorrow in UTC

async function withCreateTime(page, role, email, body) {
  await page.route(REST, r => r.fulfill({
    contentType: 'application/json', body: JSON.stringify(body) }));
  await open(page, role, email);
}
const found = (orders, when) => orders.map(o => ({ found: {
  name: 'projects/gatecheck-202a4/databases/(default)/documents/orders/_' + o,
  createTime: when } }));

test('the day comes from when the sheet was loaded, not when it is opened',
  async ({ page }) => {
  await withCreateTime(page, 'office', 'mbmccookreceiving@martin-brower.com',
    found(['8065800', '8052671', '8056594'], LOADED));
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  const days = await page.evaluate(() =>
    DB.orders.filter(o => o.vendor === 'GRAPHIC PACKAGING').map(o => o.date));
  expect(new Set(days)).toEqual(new Set(['2026-08-20']));
  expect(days[0]).not.toBe(await page.evaluate(() => isoToday()));
});

test('and it is written back under that day', async ({ page }) => {
  await withCreateTime(page, 'office', 'mbmccookreceiving@martin-brower.com',
    found(['8065800', '8052671', '8056594'], LOADED));
  await page.waitForFunction(() => (window.__fb.written || []).length >= 3);
  const written = await page.evaluate(() => window.__fb.written);
  written.forEach(w => expect(w.date).toBe('2026-08-20'));
});

test('a sheet loaded in the evening keeps the evening’s day, not UTC’s next one',
  async ({ page }) => {
  await withCreateTime(page, 'office', 'mbmccookreceiving@martin-brower.com',
    found(['8065800', '8052671', '8056594'], LOADED));
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  const day = await page.evaluate(() => {
    const d = new Date('2026-08-20T19:15:00.000Z');
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
         + '-' + String(d.getDate()).padStart(2,'0');
  });
  const got = await page.evaluate(() =>
    DB.orders.filter(o => o.vendor === 'GRAPHIC PACKAGING')[0].date);
  expect(got).toBe(day);
});

test('if the create time cannot be read, today stands in rather than nothing',
  async ({ page }) => {
  await page.route(REST, r => r.fulfill({ status: 500, body: 'no' }));
  await open(page, 'office', 'mbmccookreceiving@martin-brower.com');
  await page.waitForFunction(() => DB.orders.every(o => !!o.date));
  const got = await page.evaluate(() =>
    DB.orders.filter(o => o.vendor === 'GRAPHIC PACKAGING')[0].date);
  expect(got).toBe(await page.evaluate(() => isoToday()));
});

test('days that already have a date are never looked up at all', async ({ page }) => {
  let asked = 0;
  await page.route(REST, r => { asked++; r.fulfill({ contentType:'application/json', body:'[]' }); });
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB,
    { user:{ email:'mbmccookreceiving@martin-brower.com' }, role:'office', orders: DATED });
  await page.goto('/index.html');
  await page.waitForFunction(() => DB.office.length === 2);
  await page.waitForTimeout(500);
  expect(asked).toBe(0);
});
