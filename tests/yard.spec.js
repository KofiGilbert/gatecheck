const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function onYard(page) {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' } });
  await expect(page.locator('#login')).toBeHidden();
  await page.click('#sec-home .tile[onclick*="yard"]');
  await expect(page.locator('#sec-yard')).toBeVisible();
}

async function onSheet(page) {
  await onYard(page);
  /* A slot with no check opens the trailer grid, which is the point of the
     grid. The sheet is what a slot that HAS been checked opens, so say so
     rather than depending on the hour the suite happens to run at. */
  await page.evaluate(() => {
    const slot = ycShiftSlots()[0];
    DB.yardchecks = [{ date: ycSlotDate(slot), time: slot, officer: 'Kobe', trailers: [] }];
    ycPersistAll();
  });
  await page.click('#ycslots .slot >> nth=0');       // open a slot's sheet
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
}

test('the page is laid out like the printed sheet', async ({ page }) => {
  await onSheet(page);
  const brand = page.locator('#sec-yardsheet .ycbrand');
  await expect(brand).toContainText('F-US399-QS-36 Trailer Inspection Log');
  await expect(page.locator('.yclogo')).toBeVisible();
  await expect(brand).toContainText('Freezer 0');
  expect(await brand.evaluate(el => getComputedStyle(el).textAlign)).toBe('center');

  const fields = page.locator('#sec-yardsheet .ycfields');
  expect(await fields.evaluate(el => getComputedStyle(el).textAlign)).toBe('left');
  await expect(fields).toContainText('DATE:');
  await expect(fields).toContainText('TIME:');
  await expect(fields).toContainText('00, 02, 04, 06, 08, 10, 12, 14, 16, 18, 20, 22');
  await expect(fields).toContainText('NAME:');
  const b = await brand.boundingBox(), f = await fields.boundingBox();
  expect(b.y, 'title must sit above the fields').toBeLessThan(f.y);
});

test('an empty sheet still shows the ruled grid', async ({ page }) => {
  await onSheet(page);
  await page.evaluate(() => { YC.rows = []; renderYard(); });
  await expect(page.locator('#ycrows table')).toBeVisible();
  await expect(page.locator('#ycrows table tr')).toHaveCount(19);   // header + 18
  const heads = page.locator('#ycrows table th');
  await expect(heads.nth(0)).toHaveText('TRAILER#');
  await expect(heads.nth(2)).toHaveText('TEMP SET POINT');
  await expect(heads.nth(7)).toContainText('*ESCALATE*');
  await expect(page.locator('#ycrows')).not.toContainText('No trailers yet');
});

test('the grid is plain ruled, not a coloured header bar', async ({ page }) => {
  await onSheet(page);
  const th = await page.locator('#ycrows table th').first().evaluate(el => ({
    bg: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
    border: getComputedStyle(el).borderTopWidth,
  }));
  // white cell, dark text, a visible rule: a facsimile of the printed sheet
  expect(th.bg).toMatch(/rgb\(255, 255, 255\)/);
  expect(th.color).not.toMatch(/rgb\(255, 255, 255\)/);
  expect(parseFloat(th.border)).toBeGreaterThan(0);
});

test('the sheet keeps only what it needs', async ({ page }) => {
  await onSheet(page);
  const sheet = page.locator('#sec-yardsheet');
  await expect(sheet).toContainText('Import trailer list from photo');
  await expect(sheet).toContainText('Preview & check log');
  await expect(sheet).toContainText('Add trailer');
  // removed
  await expect(sheet).not.toContainText('Same trailers as last check');
  await expect(sheet).not.toContainText('Start a new blank yard check');
  await expect(sheet).not.toContainText('Past yard checks');
  await expect(page.locator('#ychist')).toHaveCount(0);
});

test('import sits above the form', async ({ page }) => {
  await onSheet(page);
  const imp = await page.locator('button:has-text("Import trailer list from photo")').boundingBox();
  const doc = await page.locator('#sec-yardsheet .ycdoc').boundingBox();
  const grid = await page.locator('#ycrows').boundingBox();
  expect(imp.y, 'import should come before the form').toBeLessThan(doc.y);
  expect(doc.y).toBeLessThan(grid.y);
});

test('date, time and officer are fixed by the slot, not editable', async ({ page }) => {
  await onYard(page);
  const shift = await page.evaluate(() => ycShiftSlots());
  await page.evaluate(() => sset('gc_offname_kofi@martinbrower.com','Musiliu Ibrahim'));
  await page.click('#ycslots .slot >> nth=2');
  await expect(page.locator('#yc_time')).toHaveText(shift[2]);
  await expect(page.locator('#yc_name')).toHaveText('Musiliu Ibrahim');
  await expect(page.locator('#yc_date')).not.toBeEmpty();
  // none of them are form controls any more
  for (const id of ['yc_date','yc_time','yc_name']) {
    const tag = await page.locator('#' + id).evaluate(el => el.tagName);
    expect(tag, `${id} should not be editable`).not.toBe('INPUT');
    expect(tag).not.toBe('SELECT');
  }
  const r = await page.evaluate(() => ({ time: YC.time, date: YC.date, name: YC.name }));
  expect(r.time).toBe(shift[2]);
  expect(r.name).toBe('Musiliu Ibrahim');
  expect(r.date).toBe(await page.evaluate((s) => ycSlotDate(s), shift[2]));
});

test('opening a slot sets the sheet to that slot', async ({ page }) => {
  await onYard(page);
  const shift = await page.evaluate(() => ycShiftSlots());
  await page.click('#ycslots .slot >> nth=1');
  await expect(page.locator('#yc_time')).toHaveText(shift[1]);
  await page.goBack();
  await page.click('#ycslots .slot >> nth=4');
  await expect(page.locator('#yc_time')).toHaveText(shift[4]);
});

test('the officer name follows whoever is signed in', async ({ page }) => {
  await onYard(page);
  await page.evaluate(() => sset('gc_offname_kofi@martinbrower.com','Vincent Adjei'));
  await page.click('#ycslots .slot >> nth=0');
  await expect(page.locator('#yc_name')).toHaveText('Vincent Adjei');
  await page.reload();
  await page.waitForFunction(() => typeof window.renderYard === 'function');
  await page.evaluate(() => go('yard'));           // reload deep-links to the sheet
  await page.click('#ycslots .slot >> nth=0');
  await expect(page.locator('#yc_name')).toHaveText('Vincent Adjei');
});

test('adding a trailer fills the first row and keeps the sheet full', async ({ page }) => {
  await onSheet(page);
  await page.evaluate(() => { YC.rows = []; renderYard(); });
  await page.click('button:has-text("Add trailer")');
  await expect(page.locator('#ycrows table tr')).toHaveCount(19);
  const first = page.locator('#ycrows table tr').nth(1);
  await expect(first.locator('input').first()).toBeVisible();
});


/* ---- slot board ---- */
test('an officer sees only their own shift: six checks', async ({ page }) => {
  await onYard(page);
  await expect(page.locator('#ycslots .slot')).toHaveCount(6);
  await expect(page.locator('#ycsamples')).toHaveCount(0);

  const r = await page.evaluate(() => ({
    am: ycShiftSlots(new Date(2026, 7, 21, 9, 0)),
    pm: ycShiftSlots(new Date(2026, 7, 21, 20, 0)),
    lateNight: ycShiftSlots(new Date(2026, 7, 21, 2, 0)),
    boundaryAm: ycShiftSlots(new Date(2026, 7, 21, 6, 0)),
    boundaryPm: ycShiftSlots(new Date(2026, 7, 21, 18, 0)),
    shown: [...document.querySelectorAll('#ycslots .slot .hero b')].map(e => e.textContent),
  }));
  expect(r.am).toEqual(['0600','0800','1000','1200','1400','1600']);
  expect(r.pm).toEqual(['1800','2000','2200','0000','0200','0400']);
  expect(r.lateNight, 'after midnight is still the evening shift').toEqual(r.pm);
  expect(r.boundaryAm, '06:00 starts the morning shift').toEqual(r.am);
  expect(r.boundaryPm, '18:00 starts the evening shift').toEqual(r.pm);
  // the board shows exactly the current shift, in order
  const expected = await page.evaluate(() => ycShiftSlots().map(s => s.slice(0,2)));
  expect(r.shown).toEqual(expected);
});

test('the evening shift dates its after-midnight checks to the next day', async ({ page }) => {
  await onYard(page);
  const r = await page.evaluate(() => {
    const h = new Date().getHours();
    return { hour: h, midnightSlot: ycSlotDate('0000'), today: ycTodayISO(),
             eveningSlot: ycSlotDate('1800') };
  });
  if (r.hour >= 18) {
    expect(r.midnightSlot, '00:00 belongs to tomorrow').not.toBe(r.today);
  } else if (r.hour < 6) {
    expect(r.eveningSlot, '18:00 belonged to yesterday').not.toBe(r.today);
  }
});

test('the cards are playing-card shaped', async ({ page }) => {
  for (const v of [{width:390,height:844},{width:820,height:1180},{width:1280,height:900}]) {
    await page.setViewportSize(v);
    await onYard(page);
    for (let i = 0; i < 3; i++) {
      const b = await page.locator('#ycslots .slot').nth(i).boundingBox();
      const ratio = b.width / b.height;
      expect(ratio, `${v.width}px card ${i} is ${b.width.toFixed(0)}x${b.height.toFixed(0)}`)
        .toBeGreaterThan(0.66);
      expect(ratio).toBeLessThan(0.78);
      expect(b.height, `${v.width}px card ${i} too small`).toBeGreaterThan(120);
    }
  }
});

test('each card shows its due time once, the right way up', async ({ page }) => {
  await onYard(page);
  const first = page.locator('#ycslots .slot').first();
  await expect(first.locator('.hero b')).toHaveCount(1);
  const firstSlot = await page.evaluate(() => ycShiftSlots()[0].slice(0,2));
  await expect(first.locator('.hero b')).toHaveText(firstSlot);
  const rotated = await first.evaluate(el =>
    [...el.querySelectorAll('*')].some(n => {
      const t = getComputedStyle(n).transform;
      return t && t !== 'none' && t.includes('-1');
    }));
  expect(rotated, 'no upside-down text on the card').toBe(false);
});

test('cards respond to the pointer', async ({ page }) => {
  await onYard(page);
  const hasHover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
  test.skip(!hasHover, 'touch device: no hover state by design');
  const card = page.locator('#ycslots .slot').first();
  expect(await card.evaluate(el => getComputedStyle(el).cursor)).toBe('pointer');
  const before = await card.evaluate(el => getComputedStyle(el).boxShadow);
  await card.hover();
  await page.waitForTimeout(220);
  const after = await card.evaluate(el => getComputedStyle(el).boxShadow);
  expect(after, 'card must react on hover').not.toBe(before);
});

/* ---- the colour code ---- */
test('every state has its own colour, and white type on it', async ({ page }) => {
  await onYard(page);
  const seen = await page.evaluate(() => {
    const N = Date.now(), sh = ycShiftSlots();
    DB.yardchecks = [
      { date:ycSlotDate(sh[0]), time:sh[0], name:'A', ts:new Date(N-6*3600e3).toISOString(),
        rows:[{escalate:[]},{escalate:[]}] },
      { date:ycSlotDate(sh[1]), time:sh[1], name:'B', ts:new Date(N-4*3600e3).toISOString(),
        rows:[{escalate:['TEMP']},{escalate:[]}] },
    ];
    const live = sh.find(x => !ycSlotWindowClosed(x)) || sh[5];
    DB.yardslots = [{ date:ycSlotDate(live), slot:live, loadedAt:new Date().toISOString(), count:9 }];
    renderYardSlots();
    const out = {};
    document.querySelectorAll('#ycslots .slot').forEach(el => {
      const cs = getComputedStyle(el);
      const cls = [...el.classList].find(c => c !== 'slot');
      if (cls && !out[cls]) out[cls] = { bg: cs.backgroundColor, fg: cs.color };
    });
    return out;
  });
  const states = Object.keys(seen);
  expect(states.length, 'expected several distinct states on the board').toBeGreaterThanOrEqual(4);
  const colours = states.map(k => seen[k].bg);
  expect(new Set(colours).size, 'every state must have its own fill').toBe(colours.length);
  for (const k of states) {
    expect(seen[k].fg, `${k} type should be white on colour`).toBe('rgb(255, 255, 255)');
    expect(seen[k].bg, `${k} must be filled, not transparent`).not.toContain('rgba(0, 0, 0, 0)');
  }
});

test('a slot with nothing loaded is simply awaiting the list', async ({ page }) => {
  await onYard(page);
  const st = await page.evaluate(() => {
    const cur = ycCurrentSlotIndex();
    const i = (cur + 4) % 12;
    return { s: ycSlotStatus(YC_SLOTS[i]), closed: ycSlotWindowClosed(YC_SLOTS[i]) };
  });
  if (!st.closed) {
    expect(st.s.top).toBe('Awaiting list');
    expect(st.s.cls).toBe('wait');
  }
});

test('there is no such thing as a missed check', async ({ page }) => {
  await onYard(page);
  const tops = await page.evaluate(() => YC_SLOTS.map(s => ycSlotStatus(s).top));
  expect(tops).not.toContain('Missed');
  await expect(page.locator('#ycslots')).not.toContainText('Missed');
});

test('loading a slot starts a one-hour window', async ({ page }) => {
  await onYard(page);
  const r = await page.evaluate(() => {
    const slot = YC_SLOTS[3];
    DB.yardslots = [{ date: ycTodayISO(), slot, loadedAt: new Date().toISOString(), count: 11 }];
    const now = ycSlotStatus(slot);
    DB.yardslots = [{ date: ycTodayISO(), slot, loadedAt: new Date(Date.now() - 20*60000).toISOString(), count: 11 }];
    return { now, later: ycSlotStatus(slot), window: YC_WINDOW_MIN };
  });
  expect(r.window).toBe(60);
  expect(r.now.top).toBe('Ready to start');
  expect(r.now.mins).toBe(60);
  expect(r.now.kpi).toBe('100%');
  expect(r.later.mins).toBe(40);
  expect(r.later.kpi).toBe('67%');
  expect(r.later.bar).toBeCloseTo(40/60, 2);
  expect(r.later.detail).toContain('11 trailers');
});

test('past the hour it is Overdue, and still actionable', async ({ page }) => {
  await onYard(page);
  const st = await page.evaluate(() => {
    const slot = YC_SLOTS[3];
    DB.yardslots = [{ date: ycTodayISO(), slot, loadedAt: new Date(Date.now() - 75*60000).toISOString() }];
    renderYardSlots();
    return ycSlotStatus(slot);
  });
  expect(st.top).toBe('Overdue');
  expect(st.cls).toBe('over');
  expect(st.arrow).toBe('\u2197');
  expect(st.kpi).toMatch(/^\d+%$/);
  await page.click('#ycslots .slot >> nth=3');
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
});

test('a completed check shows when and who', async ({ page }) => {
  await onYard(page);
  const st = await page.evaluate(() => {
    const slot = YC_SLOTS[2];
    DB.yardchecks.push({ date: ycTodayISO(), time: slot, rows: [{escalate:[]}],
                         name: 'Musiliu Ibrahim', ts: new Date(2026,7,21,8,12).toISOString() });
    return ycSlotStatus(slot);
  });
  expect(st.top).toBe('Completed');
  expect(st.detail).toContain('08:12');
  expect(st.detail).toContain('Musiliu');
});

test('the officer is told when a check becomes available', async ({ page }) => {
  await onYard(page);
  await page.evaluate(() => {
    DB.yardslots = [{ date: ycTodayISO(), slot: YC_SLOTS[5], loadedAt: new Date().toISOString() }];
    ycNotifyReady();
  });
  const toast = page.locator('#toast');
  await expect(toast).toContainText('ready to start');
  await expect(toast).toContainText('One hour');
  await page.evaluate(() => { $('toast').textContent=''; ycNotifyReady(); });
  await expect(toast).toBeEmpty();
});

test('a waiting yard check is announced in the header, not on the tile', async ({ page }) => {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' } });
  await page.evaluate(() => {
    DB.yardslots = [
      { date: ycSlotDate(ycShiftSlots()[1]), slot: ycShiftSlots()[1], loadedAt: new Date().toISOString() },
      { date: ycSlotDate(ycShiftSlots()[2]), slot: ycShiftSlots()[2], loadedAt: new Date(Date.now()-90*60000).toISOString() },
    ];
    ycUpdateBadge();
  });
  const bell = page.locator('#notif');
  await expect(bell).toBeVisible();
  await expect(page.locator('#notifn')).toHaveText('2');
  await expect(bell).toHaveAttribute('aria-label', /2 yard checks are ready/);
  // the count is off the tile
  await expect(page.locator('#sec-home .tile', { hasText: 'Yard Check' })).not.toContainText('2');
  await expect(page.locator('#yardbadge')).toHaveCount(0);

  // it says what is waiting; it does not carry the officer off
  await bell.click();
  const panel = page.locator('#notifpanel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#sec-home')).toBeVisible();      // still where they were
  await expect(panel.locator('.npitem')).toHaveCount(2);
  await expect(panel).toContainText('Yard checks waiting');

  // going there is a second, deliberate tap
  await panel.locator('.npitem').first().click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#sec-home')).toBeHidden();
});

test('the message closes on Escape and on a tap outside', async ({ page }) => {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' } });
  await page.evaluate(() => {
    DB.yardslots = [{ date: ycSlotDate(ycShiftSlots()[1]), slot: ycShiftSlots()[1],
                      loadedAt: new Date().toISOString() }];
    ycUpdateBadge();
  });
  await page.click('#notif');
  await expect(page.locator('#notifpanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#notifpanel')).toBeHidden();

  await page.click('#notif');
  await expect(page.locator('#notifpanel')).toBeVisible();
  await page.mouse.click(200, 600);
  await expect(page.locator('#notifpanel')).toBeHidden();
});

test('with nothing waiting there is no bell at all', async ({ page }) => {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' } });
  await page.evaluate(() => { DB.yardslots = []; DB.yardchecks = []; ycUpdateBadge(); });
  await expect(page.locator('#notif')).toBeHidden();
});

test('an officer is never blocked from starting a check', async ({ page }) => {
  await onYard(page);
  await page.click('#ycslots .slot >> nth=0');
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
  await expect(page.locator('#ycrows table')).toBeVisible();
});

test('a loaded slot shows how many trailers are in the block', async ({ page }) => {
  await onYard(page);
  const st = await page.evaluate(() => {
    DB.yardslots = [{ date: ycTodayISO(), slot: YC_SLOTS[2],
                      loadedAt: new Date().toISOString(), count: 14 }];
    return ycSlotStatus(YC_SLOTS[2]);
  });
  expect(st.detail).toContain('14 trailers');
});

test('the countdown is a bar and a number, not a sentence', async ({ page }) => {
  await onYard(page);
  await page.evaluate(() => {
    const sl = ycShiftSlots()[2];
    DB.yardslots = [{ date: ycSlotDate(sl), slot: sl,
                      loadedAt: new Date(Date.now() - 45*60000).toISOString(), count: 9 }];
    renderYardSlots();
  });
  const card = page.locator('#ycslots .slot').nth(2);
  const s2 = await page.evaluate(() => ycShiftSlots()[2].slice(0,2));
  await expect(card.locator('.hero b')).toHaveText(s2);
  await expect(card.locator('.bar')).toHaveCount(1);
  await expect(card).not.toContainText('min left');
  const p = await card.locator('.bar').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--p')));
  expect(p).toBeGreaterThan(0.2);
  expect(p).toBeLessThan(0.3);
  await expect(card).toHaveAttribute('aria-label', /15 min left/);
});

test('a clean completed check reads differently from one that escalated', async ({ page }) => {
  await onYard(page);
  const r = await page.evaluate(() => {
    const t = ycTodayISO();
    DB.yardchecks = [
      { date:ycSlotDate(ycShiftSlots()[0]), time:ycShiftSlots()[0], name:'Kobe', ts:new Date().toISOString(),
        rows:[{escalate:[]},{escalate:[]},{escalate:[]}] },
      { date:ycSlotDate(ycShiftSlots()[1]), time:ycShiftSlots()[1], name:'Kobe', ts:new Date().toISOString(),
        rows:[{escalate:[]},{escalate:['TEMP']},{escalate:['LOW FUEL']}] },
    ];
    renderYardSlots();
    return { clean: ycSlotStatus(ycShiftSlots()[0]), esc: ycSlotStatus(ycShiftSlots()[1]) };
  });
  expect(r.clean.cls).toBe('done');
  expect(r.clean.kpi).toBe('0%');
  expect(r.clean.arrow).toBe('\u2198');
  expect(r.esc.cls).toBe('esc');
  expect(r.esc.kpi).toBe('67%');            // 2 of 3 trailers escalated
  expect(r.esc.arrow).toBe('\u2197');
  const cards = page.locator('#ycslots .slot');
  const a = await cards.nth(0).evaluate(el => getComputedStyle(el).backgroundColor);
  const b = await cards.nth(1).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(b, 'an escalated check must not look like a clean one').not.toBe(a);
});

/* ---- time awareness ---- */
test('a slot whose time has passed with no check is Not recorded, never Completed', async ({ page }) => {
  await onYard(page);
  const bands = await page.evaluate(() => {
    DB.yardchecks = []; DB.yardslots = [];
    return YC_SLOTS.filter(s => ycSlotWindowClosed(s)).map(s => ycSlotStatus(s).top);
  });
  for (const band of bands) {
    expect(band).toBe('Not recorded');
    expect(band, 'a check nobody did must never read Completed').not.toBe('Completed');
  }
});

test('the current and next slots are called out even before the list arrives', async ({ page }) => {
  await onYard(page);
  const r = await page.evaluate(() => {
    DB.yardchecks = []; DB.yardslots = [];
    const cur = ycCurrentSlotIndex();
    return { cur: ycSlotStatus(YC_SLOTS[cur]),
             next: cur + 1 < 12 ? ycSlotStatus(YC_SLOTS[cur + 1]) : null };
  });
  expect(r.cur.cls).toBe('due');
  expect(r.cur.top).toBe('Due this hour');
  if (r.next) {
    expect(r.next.cls).toBe('next');
    expect(r.next.top).toBe('Up next');
  }
});

test('the ready card breathes, and stops for reduced motion', async ({ page }) => {
  await onYard(page);
  await page.evaluate(() => {
    DB.yardslots = [{ date: ycTodayISO(), slot: YC_SLOTS[ycCurrentSlotIndex()],
                      loadedAt: new Date().toISOString(), count: 12 }];
    renderYardSlots();
  });
  const card = page.locator('#ycslots .slot.ready').first();
  await expect(card).toHaveCount(1);
  const anim = await card.evaluate(el => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: parseFloat(cs.animationDuration) };
  });
  expect(anim.name).toBe('ycBreathe');
  expect(1 / anim.dur, 'pulse frequency').toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => renderYardSlots());
  const reduced = await page.locator('#ycslots .slot.ready').first()
    .evaluate(el => getComputedStyle(el).animationName);
  expect(reduced, 'motion must stop when the user asks for it').toBe('none');
});

test('only one card is loud, and none of them are invisible', async ({ page }) => {
  await onYard(page);
  await page.evaluate(() => {
    DB.yardslots = [{ date: ycTodayISO(), slot: YC_SLOTS[ycCurrentSlotIndex()],
                      loadedAt: new Date().toISOString(), count: 12 }];
    renderYardSlots();
  });
  await expect(page.locator('#ycslots .slot.ready')).toHaveCount(1);
  const cards = page.locator('#ycslots .slot');
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const m = await cards.nth(i).evaluate(el => {
      const cs = getComputedStyle(el);
      return { opacity: parseFloat(cs.opacity), bg: cs.backgroundColor,
               shadow: cs.boxShadow, page: getComputedStyle(document.body).backgroundColor };
    });
    expect(m.opacity, `card ${i} is faded`).toBe(1);
    expect(m.bg, `card ${i} has no surface of its own`).not.toBe(m.page);
    expect(m.shadow, `card ${i} has no shadow`).not.toBe('none');
  }
});


test('the card follows the reference: status on top, time in the centre, KPI below', async ({ page }) => {
  await onYard(page);
  const card = page.locator('#ycslots .slot').first();
  const box = async (sel) => (await card.locator(sel).boundingBox());
  const top = await box('.top'), hero = await box('.hero b'), band = await box('.band');
  expect(top.y).toBeLessThan(hero.y);
  expect(hero.y).toBeLessThan(band.y);
  const f0 = await page.evaluate(() => ycShiftSlots()[0].slice(0,2));
  await expect(card.locator('.hero b')).toHaveText(f0);       // written 00, 02, 04 …
  const size = await card.locator('.hero b').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(size, 'the time should be the hero').toBeGreaterThan(40);
  await expect(card.locator('.band .arw')).toHaveCount(1);
  await expect(card.locator('.band .kpi')).toHaveCount(1);
});

test('completed cards carry a real KPI, and empty states never invent one', async ({ page }) => {
  await onYard(page);
  const r = await page.evaluate(() => {
    const t = ycTodayISO();
    DB.yardchecks = [{ date:t, time:YC_SLOTS[0], name:'K', ts:new Date().toISOString(),
      rows:[{escalate:['TEMP']},{escalate:[]},{escalate:[]},{escalate:[]}] }];
    DB.yardslots = [];
    return { done: ycSlotStatus(YC_SLOTS[0]), wait: ycSlotStatus(YC_SLOTS[11]) };
  });
  expect(r.done.kpi).toBe('25%');                 // 1 of 4 escalated
  expect(r.done.kpiLabel).toBe('escalation rate');
  expect(r.wait.kpi).toBe('\u2014');               // a dash, not a fabricated number
});

test('there is a key to the colour code', async ({ page }) => {
  await onYard(page);
  const keys = page.locator('#yclegend .lg');
  await expect(keys).toHaveCount(8);
  for (const label of ['Completed','Escalations','Ready to start','Overdue',
                       'Due this hour','Up next','Awaiting list','Not recorded'])
    await expect(page.locator('#yclegend .lg', { hasText: label })).toHaveCount(1);
  // each swatch matches the card fill it stands for
  const swatch = await page.locator('#yclegend .ready i').evaluate(el => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => {
    DB.yardslots = [{ date: ycTodayISO(), slot: YC_SLOTS[ycCurrentSlotIndex()],
                      loadedAt: new Date().toISOString(), count: 5 }];
    renderYardSlots();
  });
  const cardBg = await page.locator('#ycslots .slot.ready').first()
    .evaluate(el => getComputedStyle(el).backgroundColor);
  expect(swatch).toBe(cardBg);
});

/* ---- fits the three devices ---- */
test('tablet and laptop fit all six cards without scrolling', async ({ page }) => {
  for (const s of [{name:'iPad portrait',width:820,height:1180},
                   {name:'iPad landscape',width:1180,height:820},
                   {name:'laptop',width:1440,height:900}]) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await onYard(page);
    const cards = page.locator('#ycslots .slot');
    await expect(cards).toHaveCount(6);
    for (let i = 0; i < 6; i++)
      await expect(cards.nth(i), `${s.name}: card ${i} off screen`).toBeInViewport();
    await expect(page.locator('#yclegend'), `${s.name}: legend off screen`).toBeInViewport();
    const m = await page.evaluate(() => {
      const c = document.querySelector('#ycslots .slot').getBoundingClientRect();
      return { ratio: c.width / c.height,
               scrolls: document.documentElement.scrollHeight > innerHeight + 2 };
    });
    expect(m.scrolls, `${s.name}: should not need scrolling`).toBe(false);
    expect(m.ratio, `${s.name}: cards lost their proportion`).toBeGreaterThan(0.66);
    expect(m.ratio).toBeLessThan(0.78);
  }
});

test('on a phone the cards stay comfortable and the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onYard(page);
  const cards = page.locator('#ycslots .slot');
  await expect(cards).toHaveCount(6);

  const m = await page.evaluate(() => {
    const c = document.querySelector('#ycslots .slot').getBoundingClientRect();
    const cols = getComputedStyle(document.querySelector('#ycslots')).gridTemplateColumns.split(' ').length;
    const last = document.querySelectorAll('#ycslots .slot')[5].getBoundingClientRect();
    return { w:c.width, h:c.height, cols,
             scrolls: document.documentElement.scrollHeight > innerHeight + 2,
             lastTop: last.top, vh: innerHeight };
  });
  expect(m.cols, 'two across on a phone').toBe(2);
  // comfortably above the 48px minimum touch target, not shrunk to fit
  expect(m.w, 'cards squeezed too small').toBeGreaterThan(140);
  expect(m.h).toBeGreaterThan(190);
  expect(m.scrolls, 'the phone board should scroll rather than cram').toBe(true);
  // something is cut off at the fold, which is what cues the scroll
  expect(m.lastTop, 'nothing below the fold to scroll to').toBeGreaterThan(m.vh * 0.5);

  // and everything is reachable by scrolling
  for (let i = 0; i < 6; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded();
    await expect(cards.nth(i), `card ${i} unreachable`).toBeInViewport();
  }
});

test('the board is centred on a laptop, not stuck to the top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onYard(page);
  const m = await page.evaluate(() => {
    const hdr = document.querySelector('header').getBoundingClientRect();
    const block = document.querySelector('#sec-yard .slotgroup').getBoundingClientRect();
    return { above: block.top - hdr.height, below: innerHeight - block.bottom };
  });
  // roughly equal space above and below the board
  expect(Math.abs(m.above - m.below), 'board is not vertically centred')
    .toBeLessThan(Math.max(60, (m.above + m.below) * 0.25));
});

test('the key spans the same width as the cards', async ({ page }) => {
  for (const v of [{width:390,height:844},{width:1440,height:900}]) {
    await page.setViewportSize(v);
    await onYard(page);
    const m = await page.evaluate(() => {
      const g = document.querySelector('#ycslots').getBoundingClientRect();
      const l = document.getElementById('yclegend').getBoundingClientRect();
      return { gl:g.left, gr:g.right, ll:l.left, lr:l.right };
    });
    expect(Math.abs(m.ll - m.gl), `${v.width}px: key does not start with the cards`).toBeLessThanOrEqual(4);
    expect(Math.abs(m.lr - m.gr), `${v.width}px: key does not end with the cards`).toBeLessThanOrEqual(4);
  }
});

test('the board heading names the shift and nothing more', async ({ page }) => {
  await onYard(page);
  const head = page.locator('#sec-yard .slothead');
  await expect(head).toHaveText(/^(Morning|Evening) shift$/);
  await expect(head).not.toContainText('Yard checks');
  await expect(head).not.toContainText('/');       // no date
  await expect(head).not.toContainText('6am');     // no hours
  const r = await page.evaluate(() => ({
    am: ycShiftLabel(new Date(2026,7,21,9,0)),
    pm: ycShiftLabel(new Date(2026,7,21,20,0)),
  }));
  expect(r.am).toBe('Morning shift');
  expect(r.pm).toBe('Evening shift');
});

/* ---- opening a completed check ---- */
async function withSavedCheck(page) {
  await onYard(page);
  return await page.evaluate(() => {
    const slot = ycShiftSlots()[0];
    DB.yardchecks = [{
      date: ycSlotDate(slot), time: slot, name: 'Vincent Adjei',
      ts: new Date(2026, 7, 21, 6, 42).toISOString(),
      rows: [
        { trailer:'57729', product:'FRIES', set:'-10.0', temp:'-8.5', type:'FROZEN',
          fuel:'1/4', intact:'Y', door:'N', action:'Reported to DC', escalate:['LOW FUEL: ¼ tank or less'] },
        { trailer:'LR7654', product:'FRIES', set:'-10.0', temp:'-10.3', type:'FROZEN',
          fuel:'1/2', intact:'N', door:'36', action:'', escalate:[] },
      ],
    }];
    renderYardSlots();
    return slot;
  });
}

test('a completed card opens the check that was saved', async ({ page }) => {
  await withSavedCheck(page);
  await expect(page.locator('#ycslots .slot').first()).toHaveClass(/done|esc/);
  await page.click('#ycslots .slot >> nth=0');
  await expect(page.locator('#sec-yardsheet')).toBeVisible();

  // the rows that were recorded, and only those
  const rows = page.locator('#ycrows table tr');
  await expect(rows).toHaveCount(3);                 // header + 2 recorded rows
  await expect(rows.nth(1)).toContainText('57729');
  await expect(rows.nth(1)).toContainText('-8.5');
  await expect(rows.nth(1)).toContainText('Escalate');
  await expect(rows.nth(2)).toContainText('LR7654');
  // the officer and time it was completed
  await expect(page.locator('#yc_name')).toHaveText('Vincent Adjei');
  await expect(page.locator('#ycviewbar')).toContainText('06:42');
  await expect(page.locator('#ycviewbar')).toContainText('Vincent Adjei');
});

test('a saved check cannot be edited', async ({ page }) => {
  await withSavedCheck(page);
  await page.click('#ycslots .slot >> nth=0');
  await expect(page.locator('#ycrows input')).toHaveCount(0);
  await expect(page.locator('#ycrows select')).toHaveCount(0);
  await expect(page.locator('#ycrows .delx')).toHaveCount(0);
  // the editing controls are not on screen (textContent would still see them)
  await expect(page.locator('button:has-text("Add trailer")')).toBeHidden();
  await expect(page.locator('button:has-text("Import trailer list from photo")')).toBeHidden();
  await expect(page.locator('button:has-text("Preview & check log")')).toBeHidden();
  // but it can be sent again
  await expect(page.locator('button:has-text("Email this record again")')).toBeVisible();
});

test('viewing a saved check leaves the unfinished draft alone', async ({ page }) => {
  const slot = await withSavedCheck(page);
  // start a real check on a slot that has none
  await page.click('#ycslots .slot >> nth=3');
  await page.evaluate(() => {
    YC.rows = [{trailer:'MYWORK', product:'', set:'', temp:'', type:'',
                fuel:'', intact:'', door:'', action:''}];
    ycSaveDraft();
  });
  await page.goBack();
  // look at the saved one
  await page.click('#ycslots .slot >> nth=0');
  await expect(page.locator('#ycrows table tr').nth(1)).toContainText('57729');
  await page.goBack();
  // the draft is exactly as it was
  await page.click('#ycslots .slot >> nth=3');
  await expect(page.locator('#ycrows input').first()).toHaveValue('MYWORK');
  await expect(page.locator('#ycrows')).not.toContainText('57729');
});

test('an escalation on a saved check still reads as one', async ({ page }) => {
  await withSavedCheck(page);
  await page.click('#ycslots .slot >> nth=0');
  await expect(page.locator('#ycrows table tr').nth(1)).toContainText('Escalate');
  await expect(page.locator('#ycrows table tr').nth(1)).toHaveClass(/esc/);
});
