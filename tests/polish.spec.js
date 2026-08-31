/* Three things the office noticed on the iPad: a white tile in a dark
   dashboard, a chart floating in an empty tile, a paste box that would not
   go away, and a row of figures that ran together. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });

/* An order two hours past its slot with nobody on site is a no-show, which is
   what paints the alert tile.

   The clock is pinned at two in the afternoon for these three. The appointment
   was hard-coded to 0030 and a load is not called a no-show until two hours
   past due - so run the suite between midnight and 02:30 and no time of day
   qualified at all, no alert tile was drawn, and all three failed for no
   reason but the hour it happened to be. */
const NOON_ISH = () => { const d = new Date(); d.setHours(14, 0, 0, 0); return d; };
function noShows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({
    date: 'TODAY', zone:'D', detail:'LIVE', time:'0930', in_yard:'N',
    order: '804000' + (10 + i), vendor:'COCA-COLA', carrier:'CH ROBINSON',
    cases: 900, pallets: 14,
  });
  return rows;
}

async function onStats(page, dark) {
  await page.clock.setFixedTime(NOON_ISH());
  await asOffice(page);
  await page.evaluate(({ rows, dark }) => {
    if (dark) { PREFS.theme = 'dark'; prefsSave(); }
    DB.orders = rows.map(r => Object.assign({}, r, { date: isoToday() }));
    persist();
    go('stats');
  }, { rows: noShows(5), dark: !!dark });
  await expect(page.locator('#sec-stats .btile.alert')).toBeVisible();
}

const contrast = (page, sel) => page.evaluate((s) => {
  const lum = (c) => { const n = (c.match(/\d+/g) || [0,0,0]).map(Number);
    const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(n[0]) + 0.7152*f(n[1]) + 0.0722*f(n[2]); };
  const el = document.querySelector(s);
  let bg = 'rgba(0, 0, 0, 0)';
  for (let p = el; p && bg === 'rgba(0, 0, 0, 0)'; p = p.parentElement) bg = getComputedStyle(p).backgroundColor;
  const a = lum(getComputedStyle(el).color), b = lum(bg);
  return (Math.max(a,b)+0.05) / (Math.min(a,b)+0.05);
}, sel);

test('the no-show tile is not a sheet of white in a dark dashboard', async ({ page }) => {
  await onStats(page, true);
  const bg = await page.locator('#sec-stats .btile.alert')
    .evaluate(el => getComputedStyle(el).backgroundColor);
  const card = await page.locator('#sec-stats .btile:not(.alert):not(.hero)').first()
    .evaluate(el => getComputedStyle(el).backgroundColor);
  const lum = (c) => { const n = c.match(/\d+/g).map(Number);
    return (0.2126*n[0] + 0.7152*n[1] + 0.0722*n[2]) / 255; };
  expect(lum(bg), 'the alert tile must be dark like the rest').toBeLessThan(0.4);
  expect(bg, 'but still tinted, so it still reads as an alert').not.toBe(card);
  expect(await contrast(page, '#sec-stats .btile.alert .th b')).toBeGreaterThan(4.5);
});

test('everything inside the no-show tile is readable in the dark', async ({ page }) => {
  await onStats(page, true);
  const bad = await page.evaluate(() => {
    const lum = (c) => { const n = (c.match(/\d+/g) || [0,0,0]).map(Number);
      const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
      return 0.2126*f(n[0]) + 0.7152*f(n[1]) + 0.0722*f(n[2]); };
    const out = [];
    document.querySelectorAll('#sec-stats .btile.alert *').forEach(el => {
      const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
      if (!/[a-z0-9]/i.test(txt)) return;
      let bg = 'rgba(0, 0, 0, 0)';
      for (let p = el; p && bg === 'rgba(0, 0, 0, 0)'; p = p.parentElement) bg = getComputedStyle(p).backgroundColor;
      const a = lum(getComputedStyle(el).color), b = lum(bg);
      const r = (Math.max(a,b)+0.05) / (Math.min(a,b)+0.05);
      if (r < 4.5) out.push(txt.slice(0, 22) + ' ' + r.toFixed(1) + ':1');
    });
    return out;
  });
  expect(bad).toEqual([]);
});

test('the gate chart fills its tile rather than floating at the top', async ({ page }) => {
  await onStats(page);
  const m = await page.evaluate(() => {
    const tile = document.querySelector('#sec-stats .gate').closest('.btile');
    const gate = tile.querySelector('.gate');
    const key = tile.querySelector('.ankey');
    const t = tile.getBoundingClientRect();
    const last = key || gate;
    return { gap: Math.round(t.bottom - last.getBoundingClientRect().bottom),
             tile: Math.round(t.height), wide: innerWidth >= 900,
             gate: Math.round(gate.getBoundingClientRect().height) };
  });
  // nothing but the tile's own padding may sit under the last thing in it
  expect(m.gap, 'dead space under the chart').toBeLessThan(30);
  // on a phone the tiles stack, so each is exactly as tall as it needs to be
  // and there is nothing to grow into; the gap check is what matters there
  if (m.wide) expect(m.gate, 'the bars grew into the tile').toBeGreaterThan(132);
});

test('a paste box opened by mistake can be put away', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.locator('#dzplus').click();
  await page.locator('#dzmenu button', { hasText: 'Paste rows' }).click();
  await expect(page.locator('#pastebox')).toBeVisible();
  await expect(page.locator('#pastebox')).toContainText('Paste rows from Excel');
  await page.click('.pbclose');
  await expect(page.locator('#pastebox')).toBeHidden();
});

test('what was typed does not linger after it is closed', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate(() => ingPasteBox());
  await page.fill('#paste', 'half a sheet');
  await page.click('.pbclose');
  await page.evaluate(() => ingPasteBox());
  await expect(page.locator('#paste')).toHaveValue('');
});

test('loading the pasted rows puts the box away too', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate(() => ingPasteBox());
  await page.fill('#paste', [
    'Date\tZone\tOrder Number\tVendor Name\tAppointment Carrier\tOpen Cases\tPallets',
    '2026-09-04\tD\t80900011\tKRAFT\tSUNSET TRANS\t500\t9',
  ].join('\n'));
  await page.click('button:has-text("Load pasted rows")');
  await expect(page.locator('#draftcard')).toBeVisible();
  await expect(page.locator('#pastebox')).toBeHidden();
});

/* ---- the day row ---- */
async function twoDays(page) {
  await asOffice(page);
  await page.evaluate(() => {
    DB.orders = [
      { date:'2026-09-01', zone:'D', order:'80400010', vendor:'A', cases:20000, pallets:300 },
      { date:'2026-09-01', zone:'D', order:'80400012', vendor:'C', cases:3539,  pallets:5   },
      { date:'2026-09-02', zone:'D', order:'80400011', vendor:'B', cases:7839,  pallets:144 },
      { date:'2026-09-02', zone:'D', order:'80400013', vendor:'D', cases:0,     pallets:0   },
    ];
    persist(); renderSched(); go('sched');
  });
  await expect(page.locator('#sched .daybar')).toHaveCount(2);
}

test('the figures are three columns, not one sentence', async ({ page }) => {
  await twoDays(page);
  const row = page.locator('#sched .daybar').first();
  await expect(row.locator('.dbstat')).toHaveCount(3);
  await expect(row.locator('.dbstat').nth(0)).toContainText('orders');
  await expect(row.locator('.dbstat').nth(1)).toContainText('cases');
  await expect(row.locator('.dbstat').nth(2)).toContainText('pallets');
  await expect(row.locator('.dbstat').nth(0).locator('b')).toHaveText('2');
  await expect(row.locator('.dbstat').nth(1).locator('b')).toHaveText('7,839');
});

test('the numbers line up down the list, the way a ledger reads', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });     // iPad landscape
  await twoDays(page);
  const rights = await page.locator('#sched .daybar').evaluateAll(rows =>
    rows.map(r => [...r.querySelectorAll('.dbstat b')]
      .map(b => Math.round(b.getBoundingClientRect().right))));
  expect(rights[0], 'both rows have three figures').toHaveLength(3);
  for (let i = 0; i < 3; i++)
    expect(Math.abs(rights[0][i] - rights[1][i]), 'column ' + i + ' is not aligned')
      .toBeLessThanOrEqual(1);
});

test('the numbers are tabular, so digits do not shuffle', async ({ page }) => {
  await twoDays(page);
  const f = await page.locator('#sched .dbstat b').first()
    .evaluate(el => getComputedStyle(el).fontVariantNumeric);
  expect(f).toContain('tabular-nums');
});

test('the actions are set apart from the figures by a rule', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await twoDays(page);
  const w = await page.locator('#sched .dbicons').first()
    .evaluate(el => getComputedStyle(el).borderLeftWidth);
  expect(parseFloat(w)).toBeGreaterThan(0);
});

test('the icons are drawn, not emoji, so all three sit straight', async ({ page }) => {
  await twoDays(page);
  const icons = page.locator('#sched .daybar').first().locator('.dbico');
  await expect(icons).toHaveCount(3);
  await expect(icons.nth(0).locator('svg')).toHaveCount(1);
  await expect(icons.nth(1).locator('svg')).toHaveCount(1);
  await expect(icons.nth(2).locator('svg')).toHaveCount(1);
  const boxes = await icons.evaluateAll(els =>
    els.map(e => Math.round(e.querySelector('svg').getBoundingClientRect().width)));
  expect(new Set(boxes).size, 'all three the same size').toBe(1);
});

test('the icons still say what they do, for a screen reader', async ({ page }) => {
  await twoDays(page);
  const row = page.locator('#sched .daybar').first();
  for (const label of ['Preview', 'Edit', 'Delete'])
    await expect(row.locator(`[aria-label^="${label}"]`)).toHaveCount(1);
});

test('on a phone the figures wrap under the date instead of squeezing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await twoDays(page);
  const m = await page.evaluate(() => {
    const row = document.querySelector('#sched .daybar');
    const date = row.querySelector('.dbdate').getBoundingClientRect();
    const sum = row.querySelector('.dbsum').getBoundingClientRect();
    return { below: sum.top >= date.bottom - 2, fits: sum.right <= innerWidth + 1 };
  });
  expect(m.below, 'the figures move under the date').toBe(true);
  expect(m.fits, 'and nothing hangs off the screen').toBe(true);
});
