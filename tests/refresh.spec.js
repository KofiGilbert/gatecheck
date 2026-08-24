const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* Pressing refresh should reload the screen the officer is on, not throw them
   back to the start. That means the address has to carry the screen AND the
   thing open inside it. */

const asOfficer = (p) => H.gotoApp(p, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
const asOffice  = (p, orders) => H.gotoApp(p,
  { user:{email:'office@martinbrower.com'}, role:'office', orders: orders || [] });

const shown = (page) => page.evaluate(() =>
  (document.querySelector('section.on') || {}).id || null);

const ORDER = { date:'2026-08-16', zone:'F', detail:'DROP', time:'700', in_yard:'N',
  order:'8036385', vendor:'MCCAIN CA: CARBERRY', carrier:'DAY&ROSS', contact:'',
  cases:1134, pallets:21 };

/* seed through the stub, so the schedule snapshot delivers the order rather
   than racing it and wiping what the test just set */
async function withOrders(page) {
  await page.waitForFunction(() => DB.orders.length === 1);
  await page.evaluate(() => persist());
}

/* ---- every screen ---- */

for (const sec of ['yard','log','form','hist','search','settings']) {
  test('an officer refreshing on ' + sec + ' comes back to ' + sec, async ({ page }) => {
    await asOfficer(page);
    await page.evaluate((s) => go(s), sec);
    expect(await page.evaluate(() => location.hash)).toBe('#' + sec);
    await page.reload();
    await expect(page.locator('#sec-' + sec)).toBeVisible();
    expect(await shown(page)).toBe('sec-' + sec);
    expect(await page.evaluate(() => location.hash)).toBe('#' + sec);
  });
}

for (const sec of ['office','sched','block','settings']) {
  test('the office refreshing on ' + sec + ' comes back to ' + sec, async ({ page }) => {
    await asOffice(page);
    await page.evaluate((s) => go(s), sec);
    await page.reload();
    await expect(page.locator('#sec-' + sec)).toBeVisible();
    expect(await shown(page)).toBe('sec-' + sec);
    expect(await page.evaluate(() => location.hash)).toBe('#' + sec);
  });
}

/* ---- the yard sheet remembers which check ---- */

test('refreshing inside a yard check comes back to the same slot', async ({ page }) => {
  await asOfficer(page);
  const slot = await page.evaluate(() => { go('yard'); const s = ycShiftSlots()[2];
    ycOpenSlot(s); return s; });
  // a check still to be done opens as tabs
  expect(await page.evaluate(() => location.hash)).toBe('#ycgrid/' + slot);

  await page.reload();
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
  expect(await page.evaluate(() => YC.time)).toBe(slot);
  expect(await page.evaluate(() => location.hash)).toBe('#ycgrid/' + slot);
  await expect(page.locator('#ycg_slot')).toContainText(slot.slice(0,2));
});

test('a saved check reopens read only after a refresh', async ({ page }) => {
  await asOfficer(page);
  const slot = await page.evaluate(() => {
    go('yard');
    const s = ycShiftSlots()[0];
    DB.yardchecks = [{ date: ycSlotDate(s), time: s, name:'Vincent Adjei',
      ts: new Date(2026,7,21,6,42).toISOString(),
      rows:[{ trailer:'57729', product:'FRIES', set:'-10.0', temp:'-8.5',
              type:'FROZEN', fuel:'1/4', intact:'Y', door:'N', action:'', escalate:[] }] }];
    ycPersistAll();
    ycOpenSlot(s);
    return s;
  });
  expect(await page.evaluate(() => YC_VIEW)).toBe(slot);

  await page.reload();
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
  expect(await page.evaluate(() => YC_VIEW)).toBe(slot);
  await expect(page.locator('#ycviewbar')).toBeVisible();
  await expect(page.locator('#ycrows input')).toHaveCount(0);   // still not editable
  await expect(page.locator('#ycrows')).toContainText('57729');
});

/* ---- the schedule remembers which day, and which view of it ---- */

test('refreshing inside a day comes back to that day', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','preview'); });
  expect(await page.evaluate(() => location.hash)).toBe('#sched/2026-08-16/preview');

  await page.reload();
  await expect(page.locator('#dayview')).toBeVisible();
  await expect(page.locator('#dv_date')).toHaveText('Sunday, August 16, 2026');
  await expect(page.locator('#dv_preview')).toHaveClass(/on/);
  await expect(page.locator('#dayview table.prn')).toBeVisible();
});

test('a refresh keeps the edit sheet open, not the preview', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','edit'); });
  expect(await page.evaluate(() => location.hash)).toBe('#sched/2026-08-16/edit');

  await page.reload();
  await expect(page.locator('#dayview table.dg')).toBeVisible();
  await expect(page.locator('#dv_edit')).toHaveClass(/on/);
});

test('the day opens straight from a pasted address', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.goto('/index.html#sched/2026-08-16/edit');
  await expect(page.locator('#dayview')).toBeVisible();
  await expect(page.locator('#dv_date')).toHaveText('Sunday, August 16, 2026');
  await expect(page.locator('#dayview table.dg')).toBeVisible();
});

/* ---- browser back ---- */

test('back closes the day instead of moving the app underneath it', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','preview'); });
  await page.goBack();
  await expect(page.locator('#dayview')).toBeHidden();
  await expect(page.locator('#sec-sched')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#sched');
});

test('switching between preview and edit is not a place of its own', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','preview'); });
  const len = await page.evaluate(() => history.length);
  await page.click('#dv_edit');
  expect(await page.evaluate(() => history.length)).toBe(len);   // replaced, not stacked
  expect(await page.evaluate(() => location.hash)).toBe('#sched/2026-08-16/edit');
  // so one back leaves the day rather than stepping back to the preview
  await page.goBack();
  await expect(page.locator('#dayview')).toBeHidden();
});

test('back leaves the yard sheet for the board', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => { go('yard'); ycOpenSlot(ycShiftSlots()[2]); });
  await page.goBack();
  await expect(page.locator('#sec-yard')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#yard');
});

/* ---- a screen the role may not have ---- */

test('an officer refreshing on an office address lands on their own home', async ({ page }) => {
  await asOfficer(page);
  await page.goto('/index.html#block');
  await expect(page.locator('#sec-home')).toBeVisible();
  await expect(page.locator('#sec-block')).toBeHidden();
});

test('the office refreshing on a day it may see keeps the day', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.goto('/index.html#sched/2026-08-16/preview');
  await expect(page.locator('#sec-sched')).toBeVisible();
  await expect(page.locator('#dayview')).toBeVisible();
});

/* ---- the heading sits in the middle of the bar ---- */

test('the date is centred in the black bar, not tucked beside the back arrow', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  const vp = page.viewportSize();
  for (const mode of ['preview','edit']) {
    await page.evaluate((m) => { go('sched'); dayViewOpen('2026-08-16', m); }, mode);
    const t = await page.locator('#dv_date').boundingBox();
    expect(Math.abs((t.x + t.width/2) - vp.width/2), mode).toBeLessThanOrEqual(2);
    // and it never sits on top of the controls beside it
    const back  = await page.locator('#dv_back').boundingBox();
    const right = await page.locator('#dayview .dvright').boundingBox();
    expect(t.x, mode).toBeGreaterThan(back.x + back.width);
    const clear = (t.x + t.width <= right.x) || (t.y + t.height <= right.y);
    expect(clear, mode + ': the date overlaps the view controls').toBe(true);
  }
});

test('the date stays centred once Save and Confirm appear', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  const vp = page.viewportSize();
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','edit'); });
  await page.locator('#dayview table.dg td input').nth(7).fill('CORRECTED VENDOR');
  await expect(page.locator('#dv_save')).toBeVisible();
  let t = await page.locator('#dv_date').boundingBox();
  expect(Math.abs((t.x + t.width/2) - vp.width/2)).toBeLessThanOrEqual(2);

  await page.click('#dv_save');
  await expect(page.locator('#dv_confirm')).toBeVisible();
  t = await page.locator('#dv_date').boundingBox();
  expect(Math.abs((t.x + t.width/2) - vp.width/2)).toBeLessThanOrEqual(2);
});

/* ---- the printed sheet matches the paper it replaces ---- */

test('the printed sheet puts the zone before its priority star', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => {
    /* a priority row and a plain one, so both cells can be read */
    DB.orders = DB.orders.concat([Object.assign({}, DB.orders[0],
      { order:'8041988', zone:'R', detail:'LIVE', priority:'*', vendor:'PECO FOODS' })]);
    go('sched'); dayViewOpen('2026-08-16','preview');
  });

  const heads = await page.locator('#dayview table.prn th').allInnerTexts();
  expect(heads.slice(0,5)).toEqual(['Zones','','Detail','Time','In Yard']);

  const star = page.locator('#dayview table.prn tr', { hasText: 'PECO FOODS' }).first();
  await expect(star.locator('td').nth(0)).toHaveText('R');       // zone first
  await expect(star.locator('td').nth(1)).toHaveText('★');       // then the star
  await expect(star.locator('td').nth(2)).toHaveText('LIVE');

  const plain = page.locator('#dayview table.prn tr', { hasText: 'MCCAIN' }).first();
  await expect(plain.locator('td').nth(0)).toHaveText('F');
  await expect(plain.locator('td').nth(1)).toHaveText('');       // no star, column still there
  await expect(plain.locator('td').nth(2)).toHaveText('DROP');
});

test('the totals still land under Open Cases and Pallets after the swap', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','preview'); });
  const tot = page.locator('#dayview table.prn tr.tot');
  const cells = tot.locator('td');
  await expect(cells.nth(1)).toHaveText('1,134');    // cases
  await expect(cells.nth(2)).toHaveText('21');       // pallets
  // the printed sheet has the same number of columns in every row
  const cols = await page.evaluate(() => {
    const rows = document.querySelectorAll('#dayview table.prn tr');
    return { head: rows[0].children.length,
             body: rows[1].children.length,
             tot: [].reduce.call(rows[rows.length-1].children,
                    (n, c) => n + (parseInt(c.getAttribute('colspan'),10) || 1), 0) };
  });
  expect(cols.body).toBe(cols.head);
  expect(cols.tot).toBe(cols.head);
});

/* ---- the day's totals live at the foot of the sheet, not in the heading ---- */

test('the black bar carries the date alone', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','preview'); });
  const bar = await page.locator('#dayview .dvbar').innerText();
  expect(bar).toContain('Sunday, August 16, 2026');
  expect(bar).not.toContain('cases');
  expect(bar).not.toContain('pallets');
});

test('the preview totals sit under the columns they total', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','preview'); });
  const tot = page.locator('#dayview table.prn tr.tot');
  await expect(tot).toContainText('1 order');
  // each total is column-aligned with its heading, the way the printed sheet reads
  for (const [head, cell] of [['Open Cases', 1], ['Pallets', 2]]) {
    const h = await page.locator('#dayview table.prn th', { hasText: head }).first().boundingBox();
    const c = await tot.locator('td').nth(cell).boundingBox();
    expect(Math.abs((h.x + h.width) - (c.x + c.width)), head).toBeLessThanOrEqual(2);
  }
});

test('the edit sheet totals its own columns and stays visible while scrolling', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','edit'); });
  const tot = page.locator('#dayview table.dg tr.dgtot');
  await expect(tot).toBeVisible();
  await expect(tot).toContainText('1 order');
  await expect(tot.locator('td.num').nth(0)).toHaveText('1,134');
  await expect(tot.locator('td.num').nth(1)).toHaveText('21');
  // aligned under Open Cases and Pallets, as in the printed sheet
  for (const [head, cell] of [['Open Cases', 0], ['Pallets', 1]]) {
    const h = await page.locator('#dayview table.dg tr.dghdr th', { hasText: head }).first().boundingBox();
    const c = await tot.locator('td.num').nth(cell).boundingBox();
    expect(Math.abs(h.x - c.x), head).toBeLessThanOrEqual(2);
  }
  expect(await tot.evaluate(el =>
    getComputedStyle(el.querySelector('td')).position)).toBe('sticky');
});

test('editing a figure moves the total under it', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => { go('sched'); dayViewOpen('2026-08-16','edit'); });
  await page.locator('#dayview table.dg td input').nth(10).fill('2000');   // Open Cases
  await page.click('#dv_save');
  await expect(page.locator('#dayview table.prn tr.tot')).toContainText('2,000');
});

/* ---- officers read the same schedule the office publishes ---- */

test('an officer opening the schedule lands straight on today', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const t = isoToday(), y = anShiftDate(t, -1);
    const mk = (date, order) => ({ date, order, zone:'F', detail:'DROP', time:'700',
      in_yard:'N', vendor:'MCCAIN CA: CARBERRY', carrier:'DAY&ROSS', contact:'',
      cases:1134, pallets:21 });
    DB.orders = [mk(y,'1'), mk(t,'2'), mk(t,'3')];
    persist(); go('sched');
  });
  // no bars to pick through: the sheet is open on today
  await expect(page.locator('#sched .daybar')).toHaveCount(0);
  await expect(page.locator('#dayview')).toBeVisible();
  await expect(page.locator('#dayview table.prn')).toBeVisible();
  await expect(page.locator('#dayview table.prn tr.tot')).toContainText('2 orders');
  const today = await page.evaluate(() => isoToday());
  expect(await page.evaluate(() => location.hash)).toBe('#sched/' + today + '/preview');
  // yesterday is still on file, just not the officer's business
  expect(await page.evaluate(() => DB.orders.length)).toBe(3);
});

test('with nothing booked today the officer is told so', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    DB.orders = [{ date: anShiftDate(isoToday(), -1), order:'1', zone:'F', detail:'DROP',
      time:'700', vendor:'V', carrier:'C', cases:1, pallets:1 }];
    persist(); go('sched');
  });
  await expect(page.locator('#dayview')).toBeHidden();
  // the message stands on the page; no card, no heading
  await expect(page.locator('#schednone')).toHaveText('Nothing scheduled for today.');
  await expect(page.locator('#schedcard')).toBeHidden();
  await expect(page.locator('#sched .daybar')).toHaveCount(0);
});

test('an empty database says the schedule is not loaded, not that today is empty',
  async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => { DB.orders = []; persist(); go('sched'); });
  await expect(page.locator('#schednone')).toHaveText('The schedule has not been loaded yet.');
  await expect(page.locator('#schedcard')).toBeHidden();
});

test('closing today’s sheet takes the officer home, not to a list', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    DB.orders = [{ date: isoToday(), order:'1', zone:'F', detail:'DROP', time:'700',
      vendor:'V', carrier:'C', cases:1, pallets:1 }];
    persist(); go('sched');
  });
  await expect(page.locator('#dayview')).toBeVisible();
  await page.click('#dv_back');
  await expect(page.locator('#dayview')).toBeHidden();
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('the office still gets every day, with the pencil', async ({ page }) => {
  await asOffice(page, [ORDER]);
  await withOrders(page);
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#sched .daybar')).toHaveCount(1);
  await expect(page.locator('#sched [aria-label^="Preview"]')).toHaveCount(1);
  await expect(page.locator('#sched [aria-label^="Edit"]')).toHaveCount(1);
});

test('an officer cannot reach the edit sheet, even by address', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate((o) => { DB.orders = [o]; persist(); }, ORDER);
  await page.goto('/index.html#sched/2026-08-16/edit');   // an older day, by hand
  await expect(page.locator('#dayview')).toBeVisible();
  await expect(page.locator('#dayview table.prn')).toBeVisible();
  await expect(page.locator('#dayview table.dg')).toHaveCount(0);   // dropped to preview
  await page.evaluate(() => dayViewMode('edit'));
  await expect(page.locator('#dayview table.dg')).toHaveCount(0);
});

test('loading and clearing the schedule stay with the office', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate((o) => { DB.orders = [o]; persist(); go('sched'); }, ORDER);
  await page.evaluate(() => { if(!DAYVIEW) return; dayViewClose(); });
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#sec-sched button:has-text("Upload spreadsheet")')).toBeHidden();
  await expect(page.locator('#schedcard')).toBeHidden();      // nothing today
  await expect(page.locator('#sec-sched button:has-text("Clear all schedule data")')).toBeHidden();
});
