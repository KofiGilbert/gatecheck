const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* The analytics are only worth having if the definitions are right, so most of
   these drive the arithmetic directly rather than reading it off the screen. */

const asOffice  = (p, orders) => H.gotoApp(p,
  { user:{email:'office@martinbrower.com'}, role:'office', orders: orders || [] });
const asOfficer = (p) => H.gotoApp(p, { user:{email:'kofi@martinbrower.com'}, role:'officer' });

const ord = (o) => Object.assign({ zone:'F', detail:'LIVE', priority:'', in_yard:'N',
  vendor:'A VENDOR', carrier:'ARNOLD BROS', contact:'', cases:100, pallets:10 }, o);

/* Let the stub's first snapshot land before seeding, or it wipes what we set. */
const settled = (page) => page.evaluate(() => new Promise(r => setTimeout(r, 0)));

/* Seeded the way production stores it: both records in ISO. */
async function seed(page, orders, logs, nowMin) {
  await settled(page);
  await page.evaluate(({ orders, logs, nowMin }) => {
    AN_NOW = nowMin;
    DB.orders = orders.map(o => Object.assign({}, o, { date: o.date || isoToday() }));
    DB.logs   = logs.map(l => Object.assign({}, l, { date: l.date || isoToday(),
                  id: (l.date||isoToday()) + '_' + l.po + '_' + (l.timein||'') }));
    renderStats();
  }, { orders, logs, nowMin: nowMin === undefined ? 720 : nowMin });
}
const totals = (page) => page.evaluate(() => anTotals([anRows(isoToday())]));

/* ---- reading a time off the paperwork ---- */

test('appointment times are read the way the spreadsheet writes them', async ({ page }) => {
  await asOffice(page);
  expect(await page.evaluate(() => ({
    short:   anMin('730'),      // 07:30
    long:    anMin('1730'),     // 17:30
    colon:   anMin('07:30'),
    hourOnly:anMin('9'),        // 09:00
    midnight:anMin('0'),
    unknown: anMin('???'),      // the schedule is full of these
    blank:   anMin(''),
    nully:   anMin(null),
    junk:    anMin('9999'),     // 99:99 is not a time
    tooLong: anMin('123456'),
  }))).toEqual({ short:450, long:1050, colon:450, hourOnly:540, midnight:0,
                 unknown:null, blank:null, nully:null, junk:null, tooLong:null });
});

/* ---- what counts as arrived, missed, or still to come ---- */

test('an order is arrived only once a form reaches the gate log', async ({ page }) => {
  await asOffice(page);
  await seed(page,
    [ord({ order:'1', time:'800' }), ord({ order:'2', time:'900' })],
    [{ po:'1', timein:'0800' }]);
  const t = await totals(page);
  expect(t.scheduled).toBe(2);
  expect(t.arrived).toBe(1);
  expect(t.onsite).toBe(1);         // in, no time out yet
  expect(t.completed).toBe(0);
});

test('a time out completes the visit', async ({ page }) => {
  await asOffice(page);
  await seed(page, [ord({ order:'1', time:'800' })], [{ po:'1', timein:'0800', timeout:'0930' }]);
  const t = await totals(page);
  expect(t.completed).toBe(1);
  expect(t.onsite).toBe(0);
  expect(t.arrived).toBe(1);
  expect(t.turnAvg).toBe(90);
});

test('a late truck is late, never a no-show', async ({ page }) => {
  await asOffice(page);
  // appointment 08:00, arrived 11:00, clock at noon: three hours late but present
  await seed(page, [ord({ order:'1', time:'800' })], [{ po:'1', timein:'1100' }]);
  const t = await totals(page);
  expect(t.noshow).toBe(0);
  expect(t.late).toBe(1);
  expect(t.arrived).toBe(1);
});

test('a missed appointment is not called a no-show until the grace has passed', async ({ page }) => {
  await asOffice(page);
  const at = async (nowMin) => {
    await seed(page, [ord({ order:'1', time:'800' })], [], nowMin);
    return await totals(page);
  };
  expect((await at(9 * 60)).due).toBe(1);        // 09:00, an hour late, still expected
  expect((await at(9 * 60)).noshow).toBe(0);
  expect((await at(9 * 60 + 59)).noshow).toBe(0); // 09:59, still inside two hours
  expect((await at(10 * 60 + 1)).noshow).toBe(1); // 10:01, past due by more than two hours
  expect((await at(10 * 60 + 1)).due).toBe(0);
});

test('an appointment still ahead counts as still to come', async ({ page }) => {
  await asOffice(page);
  await seed(page, [ord({ order:'1', time:'1600' })], [], 8 * 60);
  const t = await totals(page);
  expect(t.due).toBe(1);
  expect(t.noshow).toBe(0);
});

test('yesterday’s missed appointment is a no-show whatever the time is now', async ({ page }) => {
  await asOffice(page);
  await settled(page);
  await page.evaluate(() => {
    AN_NOW = 1;                                    // one minute past midnight
    const y = anShiftDate(isoToday(), -1);
    DB.orders = [{ date:y, order:'1', time:'1600', carrier:'X', cases:0, pallets:0, detail:'LIVE' }];
    DB.logs = [];
  });
  const t = await page.evaluate(() => anTotals([anRows(anShiftDate(isoToday(), -1))]));
  expect(t.noshow).toBe(1);
  expect(t.due).toBe(0);
});

test('an order with no appointment time is never scored either way', async ({ page }) => {
  await asOffice(page);
  await seed(page, [ord({ order:'1', time:'???' }), ord({ order:'2', time:'800' })], []);
  const t = await totals(page);
  expect(t.unknown).toBe(1);
  expect(t.noshow).toBe(1);          // only the one that had a time to miss
  // and the rate is measured against what could be judged, not the whole list
  expect(t.noshowRate).toBe(100);
});

/* ---- punctuality ---- */

test('on time means within fifteen minutes either side', async ({ page }) => {
  await asOffice(page);
  await seed(page, [
    ord({ order:'1', time:'800' }), ord({ order:'2', time:'800' }),
    ord({ order:'3', time:'800' }), ord({ order:'4', time:'800' }),
    ord({ order:'5', time:'800' }),
  ], [
    { po:'1', timein:'0745' },   // 15 early  -> on time
    { po:'2', timein:'0815' },   // 15 late   -> on time
    { po:'3', timein:'0744' },   // 16 early  -> early
    { po:'4', timein:'0816' },   // 16 late   -> late
    { po:'5', timein:'0800' },   // exact
  ]);
  const t = await totals(page);
  expect({ early:t.early, ontime:t.ontime, late:t.late, scored:t.scored })
    .toEqual({ early:1, ontime:3, late:1, scored:5 });
  expect(t.adherence).toBe(60);
});

/* ---- turnaround ---- */

test('a visit that runs past midnight still has a sane turnaround', async ({ page }) => {
  await asOffice(page);
  await seed(page, [ord({ order:'1', time:'2300' })], [{ po:'1', timein:'2330', timeout:'0045' }]);
  const t = await totals(page);
  expect(t.turnAvg).toBe(75);        // not minus 1365
});

test('LIVE and DROP turnarounds are kept apart', async ({ page }) => {
  await asOffice(page);
  await seed(page, [
    ord({ order:'1', time:'800', detail:'LIVE' }),
    ord({ order:'2', time:'800', detail:'DROP' }),
  ], [
    { po:'1', timein:'0800', timeout:'0900' },   // 60
    { po:'2', timein:'0800', timeout:'1400' },   // 360
  ]);
  const t = await totals(page);
  expect(t.turnLiveAvg).toBe(60);
  expect(t.turnDropAvg).toBe(360);
  expect(t.turnAvg).toBe(210);       // the blended figure on its own would mislead
});

/* ---- arrivals nobody booked ---- */

test('a truck with no appointment on the schedule is counted separately', async ({ page }) => {
  await asOffice(page);
  await seed(page, [ord({ order:'1', time:'800' })],
    [{ po:'1', timein:'0800' }, { po:'9999', timein:'0930', carrier:'WHO?' }]);
  const t = await totals(page);
  expect(t.scheduled).toBe(1);       // the schedule is not rewritten by an arrival
  expect(t.unscheduled).toBe(1);
});

test('re-sending a form does not count as a second arrival', async ({ page }) => {
  await asOffice(page);
  await settled(page);
  await page.evaluate(() => {
    AN_NOW = 720;
    DB.orders = [{ date:isoToday(), order:'1', time:'800', carrier:'X', cases:0, pallets:0, detail:'LIVE' }];
    DB.logs = [{ date:isoToday(), po:'1', timein:'0800', timeout:'' },
               { date:isoToday(), po:'1', timein:'0805', timeout:'' }];
  });
  const t = await totals(page);
  expect(t.arrived).toBe(1);
  expect(t.unscheduled).toBe(0);
});

/* ---- volumes ---- */

test('cases and pallets are counted as scheduled and as received', async ({ page }) => {
  await asOffice(page);
  await seed(page, [
    ord({ order:'1', time:'800', cases:1000, pallets:20 }),
    ord({ order:'2', time:'900', cases:500,  pallets:10 }),
  ], [{ po:'1', timein:'0800' }]);
  const t = await totals(page);
  expect({ cases:t.cases, casesIn:t.casesIn, pallets:t.pallets, palletsIn:t.palletsIn })
    .toEqual({ cases:1500, casesIn:1000, pallets:30, palletsIn:20 });
});

/* ---- carrier scorecard ---- */

test('the scorecard puts the worst carrier at the top', async ({ page }) => {
  await asOffice(page);
  await seed(page, [
    ord({ order:'1', time:'800', carrier:'GOOD HAULAGE' }),
    ord({ order:'2', time:'800', carrier:'GOOD HAULAGE' }),
    ord({ order:'3', time:'600', carrier:'MISSING TRANSPORT' }),
    ord({ order:'4', time:'600', carrier:'LATE FREIGHT' }),
  ], [
    { po:'1', timein:'0800' }, { po:'2', timein:'0805' },
    { po:'4', timein:'0900' },                     // three hours late
  ]);
  const list = await page.evaluate(() => anCarriers([anRows(isoToday())]));
  expect(list[0].carrier).toBe('MISSING TRANSPORT');    // a no-show outranks lateness
  expect(list[0].noshow).toBe(1);
  expect(list[1].carrier).toBe('LATE FREIGHT');
  expect(list[1].adherence).toBe(0);
  expect(list[2].carrier).toBe('GOOD HAULAGE');
  expect(list[2].adherence).toBe(100);
});

/* ---- on the screen ---- */

test('the office gets an Analytics tile beside Schedule and Trailer blocks', async ({ page }) => {
  await asOffice(page);
  const tiles = page.locator('#sec-office .tile');
  await expect(tiles).toHaveCount(4);      // Schedule, Trailer blocks, Gate queue, Analytics
  const analytics = tiles.filter({ hasText: 'Analytics' });
  await expect(analytics).toHaveCount(1);
  await analytics.click();
  await expect(page.locator('#sec-stats')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#stats');
});

test('officers cannot reach analytics', async ({ page }) => {
  await asOfficer(page);
  await page.goto('/index.html#stats');
  await expect(page.locator('#sec-stats')).toBeHidden();
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('the headline figures appear on the screen', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [
    ord({ order:'1', time:'800' }), ord({ order:'2', time:'800' }),
    ord({ order:'3', time:'600' }), ord({ order:'4', time:'1600' }),
  ], [{ po:'1', timein:'0800', timeout:'0930' }, { po:'2', timein:'0930' }]);

  const kpis = page.locator('#statsbody .strip .kpi');
  await expect(kpis).toHaveCount(6);
  for (const [label, n] of [['Scheduled','4'], ['Arrived','2'], ['Completed','1'],
                            ['On site','1'], ['Still to come','1'], ['No-shows','1']]) {
    await expect(kpis.filter({ hasText: label }).first().locator('b')).toHaveText(n);
  }
});

test('adherence and turnaround admit when they cannot be worked out', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [ord({ order:'1', time:'1600' })], []);      // nothing arrived
  await expect(page.locator('#statsbody')).toContainText('Nothing to time yet');
  await expect(page.locator('#statsbody')).toContainText('No completed visit yet');
});

test('the period chips change what is measured', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await settled(page);
  await page.evaluate(() => {
    AN_NOW = 720;
    const y = anShiftDate(isoToday(), -1);
    DB.orders = [{ date:isoToday(), order:'1', time:'800', carrier:'X', cases:0, pallets:0, detail:'LIVE' },
                 { date:y, order:'2', time:'800', carrier:'X', cases:0, pallets:0, detail:'LIVE' },
                 { date:y, order:'3', time:'900', carrier:'X', cases:0, pallets:0, detail:'LIVE' }];
    DB.logs = [];
    renderStats();
  });
  const scheduled = () => page.locator('#statsbody .kpi').filter({ hasText:'Scheduled' })
    .first().locator('b').innerText();

  await page.click('.anchip[data-kind="today"]');
  expect(await scheduled()).toBe('1');
  await page.click('.anchip[data-kind="yesterday"]');
  expect(await scheduled()).toBe('2');
  await page.click('.anchip[data-kind="d7"]');
  expect(await scheduled()).toBe('3');
  await expect(page.locator('#an_range')).toContainText('Last 7 days');
});

/* ---- it has to read like a dashboard, not a report ---- */

test('the dashboard is a grid of tiles, not one column of slabs', async ({ page }) => {
  // a phone stacks them, and should; this is about the laptop the office uses
  await page.setViewportSize({ width: 1440, height: 900 });
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, Array.from({length:20}, (_, i) =>
    ord({ order:String(i), time: i%2 ? '600' : '1600',
          carrier:'CARRIER '+(i%6), vendor:'VENDOR '+i })),
    [{ po:'0', timein:'1550', timeout:'1700' }]);

  const cols = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#statsbody .bento'))
      .gridTemplateColumns.split(' ').length);
  expect(cols).toBe(12);

  // tiles sit beside each other, so more than one shares a row
  const tops = await page.locator('#statsbody .btile').evaluateAll(
    els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, 'every tile on its own row is a report, not a dashboard')
    .toBeLessThan(tops.length);
});

test('a long list never lands on the dashboard itself', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  // 40 no-shows and plenty of carriers: the old build printed every one of them
  await seed(page, Array.from({length:40}, (_, i) =>
    ord({ order:String(8036000+i), time:'600', carrier:'CARRIER '+(i%12),
          vendor:'VENDOR '+i })), []);

  await expect(page.locator('#statsbody table')).toHaveCount(0);
  const chase = page.locator('#statsbody .btile').filter({ hasText:'Did not show up' });
  await expect(chase.locator('.chrow')).toHaveCount(5);      // five, not forty
  await expect(chase).toContainText('40');                    // but it says how many
  await expect(page.locator('#statsbody .clist .crow')).toHaveCount(5);
});

test('the whole picture fits a laptop screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, Array.from({length:40}, (_, i) =>
    ord({ order:String(8036000+i), time: i%3 ? '600' : '1600', carrier:'CARRIER '+(i%12) })),
    [{ po:'8036001', timein:'0600', timeout:'0700' }]);

  const h = await page.evaluate(() => document.querySelector('#statsbody .bento').scrollHeight);
  // the old build ran past four screens; one scroll of the wrist is the aim
  expect(h, 'the dashboard should not run for screens on end').toBeLessThan(1500);
});

test('see all opens the full list on its own screen', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, Array.from({length:40}, (_, i) =>
    ord({ order:String(8036000+i), time:'600', carrier:'CARRIER '+(i%12),
          vendor:'VENDOR '+i })), []);

  await page.locator('#statsbody .btile').filter({ hasText:'Did not show up' })
    .locator('.more').click();
  const list = page.locator('#anlist');
  await expect(list).toBeVisible();
  await expect(page.locator('#anlist_title')).toHaveText('Did not show up');
  await expect(list.locator('table.antab tr')).toHaveCount(41);   // header + all forty
  expect(await page.evaluate(() => location.hash)).toBe('#stats/noshow');

  // it covers the window, like the schedule day does
  const box = await list.boundingBox();
  const vp = page.viewportSize();
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.round(box.height)).toBe(vp.height);

  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(page.locator('#statsbody .bento')).toBeVisible();
});

test('the full carrier scorecard is one click from the tile', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, Array.from({length:24}, (_, i) =>
    ord({ order:String(i), time:'600', carrier:'CARRIER '+(i%12) })), []);
  await page.locator('#statsbody .btile').filter({ hasText:'Carriers to chase' })
    .locator('.more').click();
  await expect(page.locator('#anlist_title')).toHaveText('Carrier scorecard');
  await expect(page.locator('#anlist table.antab tr')).toHaveCount(13);   // header + 12
  await page.click('#anlist_back');
  await expect(page.locator('#anlist')).toBeHidden();
});

test('a full list survives a refresh', async ({ page }) => {
  // seeded through the stub, so the orders are there on the second load too
  const orders = Array.from({length:12}, (_, i) =>
    ord({ order:String(i), time:'600', date:'2000-01-01' }));
  await asOffice(page, orders);
  await page.evaluate(() => { AN_NOW = 720; anSetRange('day', '2000-01-01'); anListOpen('noshow'); });
  await expect(page.locator('#anlist')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#stats/noshow');

  await page.reload();
  await page.evaluate(() => { AN_NOW = 720; anSetRange('day', '2000-01-01'); });
  await expect(page.locator('#anlist')).toBeVisible();
  await expect(page.locator('#anlist_title')).toHaveText('Did not show up');
  await expect(page.locator('#anlist table.antab tr')).toHaveCount(13);
});

test('nothing to chase says so rather than showing an empty table', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [ord({ order:'1', time:'800' })], [{ po:'1', timein:'0800', timeout:'0900' }]);
  await expect(page.locator('#statsbody')).toContainText('Nothing to chase');
});

test('analytics survives a refresh like every other screen', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await page.reload();
  await expect(page.locator('#sec-stats')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#stats');
});

/* ---- the two records do not agree on a date format ---- */

test('a gate log row written before the fix still joins to the schedule', async ({ page }) => {
  await asOffice(page);
  expect(await page.evaluate(() => ({
    iso:    isoDate('2026-08-22'),
    log:    isoDate('8/22/26'),      // the format the seal form writes
    padded: isoDate('08/22/2026'),
    junk:   isoDate('nonsense'),
    blank:  isoDate(''),
  }))).toEqual({ iso:'2026-08-22', log:'2026-08-22', padded:'2026-08-22',
                 junk:'', blank:'' });

  // an order written in ISO and a log row written the officer's way are one visit
  await settled(page);
  await page.evaluate(() => {
    AN_NOW = 720;
    DB.orders = [{ date:isoToday(), order:'8036365', time:'800', carrier:'X',
                   cases:100, pallets:5, detail:'LIVE' }];
    DB.logs   = [{ date:todayStr(), po:'8036365', timein:'0800', timeout:'0900' }];  // the old form
  });
  const t = await totals(page);
  expect(t.arrived).toBe(1);
  expect(t.completed).toBe(1);
  expect(t.unscheduled).toBe(0);      // not mistaken for a truck nobody booked
  expect(t.turnAvg).toBe(60);
});

/* ---- the charts must be readable, not just correct ---- */

test('no two colours in the same key are the same', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [
    ord({ order:'1', time:'800' }), ord({ order:'2', time:'800' }),
    ord({ order:'3', time:'600' }), ord({ order:'4', time:'1600' }),
  ], [{ po:'1', timein:'0800', timeout:'0930' }, { po:'2', timein:'0930' }]);

  const keys = await page.evaluate(() =>
    [...document.querySelectorAll('#statsbody .ankey')].map(k =>
      [...k.querySelectorAll('i')].map(i => getComputedStyle(i).backgroundColor))
      .filter(c => c.length > 1));
  expect(keys.length).toBeGreaterThan(1);
  for (const colours of keys) {
    expect(colours.length).toBeGreaterThan(1);
    expect(new Set(colours).size, 'two swatches share a colour: ' + colours.join(' '))
      .toBe(colours.length);
  }
});

test('every bar states its numbers in words for a screen reader', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [ord({ order:'1', time:'800' }), ord({ order:'2', time:'600' })],
    [{ po:'1', timein:'0800', timeout:'0930' }]);
  const imgs = page.locator('#statsbody [role="img"]');
  expect(await imgs.count()).toBeGreaterThan(2);
  for (let i = 0; i < await imgs.count(); i++) {
    const label = await imgs.nth(i).getAttribute('aria-label');
    expect(label && label.length, 'a chart with no aria-label').toBeGreaterThan(10);
  }
});

test('the dashboard tiles are not the home screen’s playing cards', async ({ page }) => {
  // .tile carries aspect-ratio:1; borrowing it turned a full-width strip into a
  // 1400px square. The analytics tiles must keep their own class.
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [ord({ order:'1', time:'800' })], [{ po:'1', timein:'0800', timeout:'0900' }]);
  const ratios = await page.locator('#statsbody .btile').evaluateAll(
    els => els.map(e => getComputedStyle(e).aspectRatio));
  expect(ratios.length).toBeGreaterThan(3);
  for (const r of ratios) expect(r).toBe('auto');
  expect(await page.locator('#statsbody .tile').count()).toBe(0);
});

test('a fall in no-shows reads as good news, not bad', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await settled(page);
  await page.evaluate(() => {
    AN_NOW = 720;
    const y = anShiftDate(isoToday(), -1);
    const mk = (date, order) => ({ date, order, time:'600', carrier:'X',
      vendor:'V', cases:0, pallets:0, detail:'LIVE' });
    // four missed yesterday, one missed today
    DB.orders = [mk(y,'1'), mk(y,'2'), mk(y,'3'), mk(y,'4'), mk(isoToday(),'5')];
    DB.logs = [];
    anSetRange('today');
  });
  const kpi = page.locator('#statsbody .kpi').filter({ hasText:'No-shows' }).first();
  await expect(kpi.locator('.delta')).toHaveClass(/down/);
  const colour = await kpi.locator('.delta').evaluate(e => getComputedStyle(e).color);
  const red = await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--red').trim());
  expect(colour, 'a drop in no-shows must not be painted as a problem').not.toBe(red);
});

test('a count pill actually shows its count, legibly', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, Array.from({length:7}, (_, i) =>
    ord({ order:String(i), time:'600' })), []);
  const pill = page.locator('#statsbody .pillc').first();
  await expect(pill).toHaveText('7');
  const box = await pill.boundingBox();
  expect(box.height, 'the pill is too short to show a digit').toBeGreaterThan(13);
  expect(box.width).toBeGreaterThan(13);
  // present is not the same as visible: the digit must stand off its background
  const c = await pill.evaluate(e => {
    const s = getComputedStyle(e);
    return { fg: s.color, bg: s.backgroundColor };
  });
  expect(H.ratio(H.parseRGB(c.fg), H.parseRGB(c.bg)),
    'the count is not readable on its own pill').toBeGreaterThan(4.5);
});

test('the trend’s day labels are not stretched by the chart', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [ord({ order:'1', time:'800' })], [{ po:'1', timein:'0800' }]);
  // labels live outside the stretched SVG, so they stay legible
  await expect(page.locator('#statsbody .trend text')).toHaveCount(0);
  const labs = page.locator('#statsbody .tlabs span');
  await expect(labs).toHaveCount(7);
  const widths = await labs.evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);   // evenly spread
});

test('nothing on the dashboard is written in a colour you cannot read', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, Array.from({length:12}, (_, i) =>
    ord({ order:String(i), time: i%2 ? '600' : '1600', carrier:'CARRIER '+(i%4) })),
    [{ po:'0', timein:'0600', timeout:'0700' }, { po:'2', timein:'0700' }]);

  const bad = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('#statsbody *').forEach(el => {
      const txt = [...el.childNodes]
        .filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join('');
      if (!txt) return;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return;
      // walk up for the first painted background
      let p = el, bg = 'rgba(0, 0, 0, 0)';
      while (p && bg === 'rgba(0, 0, 0, 0)') { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; }
      const key = el.className + '|' + s.color + '|' + bg;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ cls: String(el.className), txt: txt.slice(0, 24), fg: s.color, bg,
                 size: parseFloat(s.fontSize), weight: s.fontWeight });
    });
    return out;
  });

  const fails = bad.filter(b => {
    const r = H.ratio(H.parseRGB(b.fg), H.parseRGB(b.bg));
    const large = b.size >= 24 || (b.size >= 18.66 && +b.weight >= 700);
    return r < (large ? 3 : 4.5);
  }).map(b => `${b.cls || '(no class)'} "${b.txt}" ${b.fg} on ${b.bg}`);
  expect(fails, 'unreadable text on the dashboard').toEqual([]);
});

test('on a phone the tiles stack, one to a row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asOffice(page);
  await page.evaluate(() => go('stats'));
  await seed(page, [ord({ order:'1', time:'800' }), ord({ order:'2', time:'600' })],
    [{ po:'1', timein:'0800', timeout:'0900' }]);
  const boxes = await page.locator('#statsbody .btile').evaluateAll(
    els => els.map(e => e.getBoundingClientRect()));
  expect(boxes.length).toBeGreaterThan(3);
  const tops = boxes.map(b => Math.round(b.top));
  expect(new Set(tops).size).toBe(tops.length);          // none share a row
  for (const b of boxes) expect(Math.round(b.width)).toBeGreaterThan(340);
  // and the page itself never scrolls sideways
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});
