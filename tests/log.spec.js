const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function signedIn(page) {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' } });
  await expect(page.locator('#login')).toBeHidden();
}

test('Tractor Number is on the seal form and required before pushing', async ({ page }) => {
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*=\"form\"]');
  await expect(page.locator('#f_tractor')).toBeVisible();
  const missing = await page.evaluate(() => blankFields());
  expect(missing).toContain('Tractor Number');
  await page.fill('#f_tractor', 'T-4412');
  const after = await page.evaluate(() => blankFields());
  expect(after).not.toContain('Tractor Number');
});

test('Tractor Number never reaches the form sent to the receiving office', async ({ page }) => {
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*=\"form\"]');
  await page.fill('#f_tractor', 'ZZTRACTORZZ');
  await page.fill('#f_po', '8045467');
  await page.fill('#f_trailer', 'LR7524');
  await page.fill('#f_carrier', 'POPE');
  // collect() carries it for the log...
  const d = await page.evaluate(() => collect());
  expect(d.tractor).toBe('ZZTRACTORZZ');
  // ...but drawPaper must not render it anywhere on the sent image
  const drawn = await page.evaluate(() => new Promise(res => {
    drawPaper(collect(), cv => {
      const g = cv.getContext('2d');
      const px = g.getImageData(0, 0, cv.width, cv.height).data;
      res({ w: cv.width, h: cv.height, nonEmpty: px.length > 0 });
    });
  }));
  expect(drawn.nonEmpty).toBe(true);
  const src = await page.evaluate(() => window.drawPaper.toString());
  expect(src, 'drawPaper must not reference tractor').not.toContain('d.tractor');
});

test('pushing a form adds a log row, and re-sending does not duplicate it', async ({ page }) => {
  await signedIn(page);
  await page.evaluate(() => {
    const r = { datein: todayStr(), timein:'0630', po:'8045467',
                trailer:'LR7524', carrier:'POPE', tractor:'T-4412' };
    logAdd(r); logAdd(r);          // second push must not create a second row
  });
  await page.click('#sec-home .tile[onclick*=\"log\"]');
  // the grid always shows a full page of rows, like the paper form
  await expect(page.locator('#logrows table tr:not(.logband)')).toHaveCount(15); // header + 14
  const cells = page.locator('#logrows table tr:not(.logband)').nth(1);
  await expect(cells).toContainText('0630');
  await expect(cells).toContainText('POPE');
  await expect(cells).toContainText('T-4412');
  await expect(cells).toContainText('LR7524');
});

test('rows read top-down in arrival order', async ({ page }) => {
  await signedIn(page);
  await page.evaluate(() => {
    logAdd({ datein: todayStr(), timein:'0645', po:'1', trailer:'AAA', carrier:'FIRST', tractor:'T1' });
    logAdd({ datein: todayStr(), timein:'0812', po:'2', trailer:'BBB', carrier:'SECOND', tractor:'T2' });
  });
  await page.click('#sec-home .tile[onclick*=\"log\"]');
  const rows = page.locator('#logrows table tr:not(.logband)');
  await expect(rows.nth(1)).toContainText('0645');
  await expect(rows.nth(1)).toContainText('FIRST');
  await expect(rows.nth(2)).toContainText('0812');
  await expect(rows.nth(2)).toContainText('SECOND');
});

test('officer completes Time Out and Out Trailer, and it persists', async ({ page }) => {
  await signedIn(page);
  await page.evaluate(() => logAdd({ datein: todayStr(), timein:'0630', po:'8045467',
    trailer:'LR7524', carrier:'POPE', tractor:'T-4412' }));
  await page.click('#sec-home .tile[onclick*=\"log\"]');
  const inputs = page.locator('#logrows table tr:not(.logband)').nth(1).locator('input');
  await inputs.nth(0).fill('1415');
  await inputs.nth(1).fill('MB9001');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gc_logs'))[0]);
  expect(stored.timeout).toBe('1415');
  expect(stored.outtrailer).toBe('MB9001');
  expect(stored.trailer, 'inbound trailer must not be overwritten').toBe('LR7524');
});

test('log page is laid out like the paper form', async ({ page }) => {
  await signedIn(page);
  await page.evaluate(() => { sset('gc_offname_kofi@martinbrower.com','Kobe Mensah');
                              sset('gc_location','McCook'); });
  await page.click('#sec-home .tile[onclick*=\"log\"]');
  // brand block, centred
  const brand = page.locator('#sec-log .logbrand');
  await expect(brand).toContainText('Security Services');
  await expect(brand).toContainText('Martin Brower Log');
  expect(await brand.evaluate(el => getComputedStyle(el).textAlign)).toBe('center');
  // then the left-aligned fields
  await expect(page.locator('#log_loc')).toHaveText('McCook');
  await expect(page.locator('#log_guard')).toHaveText('Kobe Mensah');
  await expect(page.locator('#log_shift')).toHaveText(/6am - 6pm|6pm - 6am/);
  await expect(page.locator('#log_date')).not.toBeEmpty();
  const fields = page.locator('#sec-log .logfields');
  expect(await fields.evaluate(el => getComputedStyle(el).textAlign)).toBe('left');
  // brand sits above the fields
  const b = await brand.boundingBox(), f = await fields.boundingBox();
  expect(b.y).toBeLessThan(f.y);
});

test('the form never touches the screen edges', async ({ page }) => {
  for (const w of [390, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await signedIn(page);
    await page.click('#sec-home .tile[onclick*=\"log\"]');
    const gaps = await page.evaluate(() => {
      const r = document.querySelector('#sec-log .logdoc').getBoundingClientRect();
      const t = document.querySelector('#sec-log .ycwrap').getBoundingClientRect();
      return { cardL: r.left, cardR: innerWidth - r.right,
               tblL: t.left,  tblR: innerWidth - t.right };
    });
    for (const [k, v] of Object.entries(gaps)) {
      expect(v, `${k} gutter at ${w}px`).toBeGreaterThanOrEqual(8);
    }
  }
});

test('shift is derived from the clock', async ({ page }) => {
  await signedIn(page);
  const r = await page.evaluate(() => ({
    morning: currentShift(new Date(2026,7,20,6,0)),
    midday:  currentShift(new Date(2026,7,20,13,0)),
    evening: currentShift(new Date(2026,7,20,18,0)),
    night:   currentShift(new Date(2026,7,20,3,0)),
  }));
  expect(r.morning).toBe('6am - 6pm');
  expect(r.midday).toBe('6am - 6pm');
  expect(r.evening).toBe('6pm - 6am');
  expect(r.night).toBe('6pm - 6am');
});

test('with nothing filled in it shows the blank form, not a message', async ({ page }) => {
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*=\"log\"]');
  const table = page.locator('#logrows table');
  await expect(table).toBeVisible();
  await expect(page.locator('#logrows table tr')).toHaveCount(15);   // header + 14 blank rows
  const heads = page.locator('#logrows table th');
  await expect(heads).toHaveCount(10);          // nine columns plus the remove gutter
  await expect(heads.nth(0)).toHaveText('Time In');
  await expect(heads.nth(2)).toHaveText('Out Trailer Number');
  await expect(heads.nth(5)).toHaveText('Trailer Number');
  await expect(heads.nth(6)).toHaveText('Plate Number');
  await expect(heads.nth(8)).toHaveText('Notes');
  await expect(page.locator('#logrows')).not.toContainText('No trailers signed in');
  await expect(page.locator('#sec-log')).not.toContainText('A row is added automatically');
});

/* ---- the gate log and the schedule agree on a date ----
   The log used to store the date the officer reads (8/22/26) while the schedule
   stores ISO, so a log row could never be matched to the order it belonged to. */

const asOfficerD = (p) => H.gotoApp(p, { user:{email:'kofi@martinbrower.com'}, role:'officer' });

test('the two date forms are kept apart, and convert cleanly', async ({ page }) => {
  await asOfficerD(page);
  expect(await page.evaluate(() => ({
    display: /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(todayStr()),
    stored:  /^\d{4}-\d{2}-\d{2}$/.test(isoToday()),
    same:    isoDate(todayStr()) === isoToday(),
    iso:     isoDate('2026-08-22'),
    short:   isoDate('8/22/26'),
    padded:  isoDate('08/22/2026'),
    junk:    isoDate('nonsense'),
    blank:   isoDate(''),
  }))).toEqual({ display:true, stored:true, same:true, iso:'2026-08-22',
                 short:'2026-08-22', padded:'2026-08-22', junk:'', blank:'' });
});

test('a pushed form writes an ISO date on the gate log row', async ({ page }) => {
  await asOfficerD(page);
  const r = await page.evaluate(() => {
    DB.logs = [];
    logAdd({ datein: todayStr(), po:'8036365', timein:'0800', carrier:'DAY&ROSS' });
    return DB.logs[0];
  });
  expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(r.id.startsWith(r.date)).toBe(true);
  // and the row is still today's as far as the log screen is concerned
  expect(await page.evaluate(() => logToday().length)).toBe(1);
});

test('a row written under the old format is read back as ISO', async ({ page }) => {
  await asOfficerD(page);
  const out = await page.evaluate(() => {
    const legacy = [{ id:'8/22/26_8036365_0800', date:'8/22/26', po:'8036365', timein:'0800' }];
    logMigrate(legacy);
    return legacy[0].date;
  });
  expect(out).toBe('2026-08-22');
});

test('re-sending a form does not duplicate a row written the old way', async ({ page }) => {
  await asOfficerD(page);
  const n = await page.evaluate(() => {
    // a row already on file under the display format, as a real device would have
    DB.logs = [{ id: todayStr()+'_8036365_0800', date: todayStr(),
                 po:'8036365', timein:'0800', timeout:'' }];
    logMigrate(DB.logs);
    logAdd({ datein: todayStr(), po:'8036365', timein:'0800' });
    return DB.logs.length;
  });
  expect(n).toBe(1);
});

test('a gate log row matches the order it belongs to', async ({ page }) => {
  await asOfficerD(page);
  const t = await page.evaluate(() => {
    AN_NOW = 720;
    DB.orders = [{ date:isoToday(), order:'8036365', time:'800', carrier:'DAY&ROSS',
                   vendor:'MCCAIN', cases:1134, pallets:21, detail:'LIVE' }];
    DB.logs = [];
    logAdd({ datein: todayStr(), po:'8036365', timein:'0800', carrier:'DAY&ROSS' });
    return anTotals([anRows(isoToday())]);
  });
  expect(t.scheduled).toBe(1);
  expect(t.arrived).toBe(1);
  expect(t.unscheduled).toBe(0);      // before the fix this was 1 scheduled, 0 arrived
});

/* ---- one continuous sheet across shifts ----
   A trailer that books in on the morning shift often leaves on the evening one,
   so any officer on duty completes any row, and the row records both hands. */

test('the officer who marks the time out is recorded', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'morning@npg.com'}, role:'officer' });
  const id = await page.evaluate(() => {
    sset('gc_offname_morning@npg.com', 'Kofi Mensah');
    DB.logs = [];
    logAdd({ datein: todayStr(), po:'8036365', timein:'0700', carrier:'DAY&ROSS' });
    return DB.logs[0].id;
  });
  const r = await page.evaluate((id) => {
    logSet(id, 'timeout', '1830');
    return DB.logs[0];
  }, id);
  expect(r.officer).toBe('morning@npg.com');
  expect(r.timeout).toBe('1830');
  expect(r.outBy).toBe('morning@npg.com');
  expect(r.outAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('an evening officer closes a row the morning officer opened', async ({ page }) => {
  // the morning shift books it in
  await H.gotoApp(page, { user:{email:'morning@npg.com'}, role:'officer' });
  const row = await page.evaluate(() => {
    sset('gc_offname_morning@npg.com', 'Kofi Mensah');
    DB.logs = [];
    logAdd({ datein: todayStr(), po:'8036365', timein:'0700', carrier:'DAY&ROSS' });
    logPersist();
    return DB.logs[0];
  });
  expect(row.officerName).toBe('Kofi Mensah');
  expect(row.outBy).toBeFalsy();

  // a different officer signs in that evening and sees the same open row
  await H.gotoApp(page, { user:{email:'evening@npg.com'}, role:'officer' });
  const after = await page.evaluate((row) => {
    sset('gc_offname_evening@npg.com', 'Vincent Adjei');
    DB.logs = [row];
    go('log');
    logSet(row.id, 'timeout', '1915');
    return DB.logs[0];
  }, row);

  expect(after.officerName).toBe('Kofi Mensah');    // who took it in
  expect(after.outByName).toBe('Vincent Adjei');    // who marked it out
  expect(after.outBy).toBe('evening@npg.com');
  // both hands are on the record; neither is printed across the sheet
  await expect(page.locator('#logrows')).not.toContainText('Kofi Mensah');
  await expect(page.locator('#logrows')).not.toContainText('Vincent Adjei');
  await expect(page.locator('#logrows td.lgout').first())
    .toHaveAttribute('title', /Vincent Adjei/);
});

test('clearing a time out clears who marked it', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'a@npg.com'}, role:'officer' });
  const out = await page.evaluate(() => {
    DB.logs = [];
    logAdd({ datein: todayStr(), po:'1', timein:'0700' });
    const id = DB.logs[0].id;
    logSet(id, 'timeout', '0900');
    logSet(id, 'timeout', '');
    return DB.logs[0];
  });
  expect(out.outBy).toBe('');
  expect(out.outByName).toBe('');
});

test('a row left open overnight stays on the sheet', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'night@npg.com'}, role:'officer' });
  const rows = await page.evaluate(() => {
    const y = anShiftDate(isoToday(), -1);
    DB.logs = [
      { id:'a', date:y, po:'8036365', timein:'2330', timeout:'', carrier:'DAY&ROSS' },
      { id:'b', date:y, po:'8036366', timein:'1400', timeout:'1500', carrier:'J&L' },
      { id:'c', date:isoToday(), po:'8036367', timein:'0700', timeout:'', carrier:'MARTEN' },
    ];
    go('log');
    return logToday().map(r => r.id);
  });
  // the trailer still on site is carried over; the one that left is not
  expect(rows).toEqual(['a', 'c']);
});

/* ---- the sheet is the officer's own shift, with what was left open above it ---- */

test('the sheet starts with what the last shift left open', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'evening@npg.com'}, role:'officer' });
  const ids = await page.evaluate(() => {
    // pin the clock to 20:00, so the evening shift began at 18:00 today
    const at8pm = new Date(); at8pm.setHours(20, 0, 0, 0);
    logShiftStart = function(){ return { date: isoToday(), min: 18*60 }; };
    currentShift = function(){ return '6pm - 6am'; };
    DB.logs = [
      { id:'open-am',  date:isoToday(), po:'1', timein:'0900', timeout:'' },
      { id:'done-am',  date:isoToday(), po:'2', timein:'1000', timeout:'1100' },
      { id:'mine-1',   date:isoToday(), po:'3', timein:'1830', timeout:'' },
      { id:'mine-2',   date:isoToday(), po:'4', timein:'1915', timeout:'' },
    ];
    go('log');
    return logToday().map(r => r.id);
  });
  // the morning's unfinished row comes first; the morning's finished one is gone
  expect(ids).toEqual(['open-am', 'mine-1', 'mine-2']);
});

test('the two blocks are labelled, and the shift on duty is named', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'evening@npg.com'}, role:'officer' });
  await page.evaluate(() => {
    sset('gc_offname_evening@npg.com', 'Vincent Adjei');
    logShiftStart = function(){ return { date: isoToday(), min: 18*60 }; };
    currentShift = function(){ return '6pm - 6am'; };
    DB.logs = [
      { id:'open-am', date:isoToday(), po:'1', timein:'0900', timeout:'',
        officerName:'Kofi Mensah' },
      { id:'mine-1',  date:isoToday(), po:'3', timein:'1830', timeout:'' },
    ];
    go('log');
  });
  const bands = page.locator('#logrows tr.logband');
  await expect(bands).toHaveCount(2);
  await expect(bands.nth(0)).toContainText('Left open by the shift before');
  await expect(bands.nth(1)).toContainText('This shift');
  // the shift and the guard are named once, in the header
  await expect(page.locator('#log_shift')).toHaveText('6pm - 6am');
  await expect(page.locator('#log_guard')).toHaveText('Vincent Adjei');
  // and the carried row is marked out
  await expect(page.locator('#logrows tr.carried')).toHaveCount(1);
});

test('with nothing left open the sheet is just this shift', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'a@npg.com'}, role:'officer' });
  await page.evaluate(() => {
    logShiftStart = function(){ return { date: isoToday(), min: 18*60 }; };
    currentShift = function(){ return '6pm - 6am'; };
    DB.logs = [{ id:'mine', date:isoToday(), po:'1', timein:'1830', timeout:'' }];
    go('log');
  });
  // nothing carried over, so there is no band to tell two blocks apart
  await expect(page.locator('#logrows tr.logband')).toHaveCount(0);
  await expect(page.locator('#logrows tr.carried')).toHaveCount(0);
});

test('after midnight the officer is still on the evening shift', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'a@npg.com'}, role:'officer' });
  const r = await page.evaluate(() => {
    const at2am = new Date(2026, 7, 22, 2, 0, 0);
    const s = logShiftStart(at2am);
    return { date: s.date, min: s.min, yesterday: anShiftDate('2026-08-22', -1) };
  });
  expect(r.min).toBe(18 * 60);
  expect(r.date).toBe(r.yesterday);      // the shift began at 18:00 the day before
});

test('any officer may close any row, whoever opened it', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'other@npg.com'}, role:'officer' });
  const saved = await page.evaluate(() => {
    DB.logs = [{ id:'x', date:isoToday(), po:'1', timein:'0700', timeout:'',
                 officer:'someone.else@npg.com', officerName:'Someone Else' }];
    go('log');
    const input = document.querySelector('#logrows tbody tr input, #logrows tr input');
    return !!input && !input.disabled && !input.readOnly;
  });
  expect(saved, 'the time out must be editable by whoever is on duty').toBe(true);
});

/* ---- the truck that comes in with nothing and leaves with a trailer ---- */

test('an officer can write a row by hand, end to end', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  // write on the next blank line, the way you would on the paper form
  await page.locator('#logrows tr.blank input[data-k="carrier"]').first().fill('POPE');

  const row = page.locator('#logrows tr.hand');
  await expect(row).toHaveCount(1);
  // every column on this row is the officer's to fill
  const cells = row.locator('input');
  await expect(cells).toHaveCount(9);

  await row.locator('input[data-k="timein"]').fill('2210');
  await row.locator('input[data-k="tractor"]').fill('T-4412');
  await row.locator('input[data-k="trailer"]').fill('N/A');   // came in with none
  await row.locator('input[data-k="outtrailer"]').fill('LR7524');
  await row.locator('input[data-k="timeout"]').fill('2245');

  const r = await page.evaluate(() => DB.logs[0]);
  expect(r.manual).toBe(true);
  expect(r.timein).toBe('2210');
  expect(r.carrier).toBe('POPE');
  expect(r.tractor).toBe('T-4412');
  expect(r.trailer).toBe('N/A');
  expect(r.outtrailer).toBe('LR7524');
  expect(r.timeout).toBe('2245');
  expect(r.outBy).toBe('kofi@martinbrower.com');   // who closed it is still recorded
});

test('a row from a seal form keeps its own facts', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => {
    DB.logs = [];
    logAdd({ datein: todayStr(), po:'8036365', timein:'0700', carrier:'DAY&ROSS',
             tractor:'T1', trailer:'LR7524' });
    go('log');
  });
  const row = page.locator('#logrows table tr').filter({ hasText:'DAY&ROSS' });
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveClass(/hand/);
  // the carrier, tractor and trailer came off a signed form: not typed over here
  await expect(row.locator('td.logro')).toHaveCount(4);
  await expect(row.locator('td.logdel button')).toHaveCount(0);   // nor removed
});

test('a hand row can be removed, a form row cannot', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  await page.locator('#logrows tr.blank input[data-k="carrier"]').first().fill('POPE');
  await expect(page.locator('#logrows tr.hand')).toHaveCount(1);
  page.once('dialog', d => d.accept());
  await page.locator('#logrows td.logdel button').click();
  await expect(page.locator('#logrows tr.hand')).toHaveCount(0);
  expect(await page.evaluate(() => DB.logs.length)).toBe(0);
});

test('typing into the sheet is never interrupted by a redraw', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  await page.locator('#logrows tr.blank input[data-k="carrier"]').first().fill('X');
  const carrier = page.locator('#logrows tr.hand input[data-k="carrier"]');
  await carrier.fill('');
  await carrier.click();
  await page.keyboard.type('WES');
  // a snapshot landing mid-word must not take the cursor away
  await page.evaluate(() => {
    logPersist();
    const typing = document.activeElement && document.activeElement.closest('#logrows');
    if(!typing) renderLog();
  });
  await page.keyboard.type('T');
  await expect(carrier).toBeFocused();
  await expect(carrier).toHaveValue('WEST');
  expect(await page.evaluate(() => DB.logs[0].carrier)).toBe('WEST');
});

test('the shift band does not repeat what the header already says', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => {
    sset('gc_offname_kofi@martinbrower.com', 'Kobe');
    DB.logs = [];
    go('log');
  });
  const bands = page.locator('#logrows tr.logband');
  for (let i = 0; i < await bands.count(); i++) {
    const t = await bands.nth(i).innerText();
    expect(t).not.toContain('KOBE');
    expect(t).not.toMatch(/6AM|6PM/);
  }
  await expect(page.locator('#log_shift')).toHaveText(/6am - 6pm|6pm - 6am/);
  await expect(page.locator('#log_guard')).toHaveText('Kobe');
});

test('writing on a blank line turns it into a row, and keeps the cursor there',
  async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  await expect(page.locator('#logrows tr.hand')).toHaveCount(0);

  const cell = page.locator('#logrows tr.blank input[data-k="carrier"]').first();
  await cell.click();
  await page.keyboard.type('WEST');

  const row = page.locator('#logrows tr.hand');
  await expect(row).toHaveCount(1);
  const live = row.locator('input[data-k="carrier"]');
  await expect(live).toHaveValue('WEST');
  await expect(live).toBeFocused();               // never had to click back in
  expect(await page.evaluate(() => DB.logs[0].carrier)).toBe('WEST');
  expect(await page.evaluate(() => DB.logs[0].timein)).toMatch(/^\d{4}$/);
});

test('a time typed on a blank line is the time that is kept', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  await page.locator('#logrows tr.blank input[data-k="timein"]').first().fill('0415');
  await expect(page.locator('#logrows tr.hand')).toHaveCount(1);
  expect(await page.evaluate(() => DB.logs[0].timein)).toBe('0415');
});

test('there is no Add a row button: the blank lines are the button', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  await expect(page.locator('#sec-log button:has-text("Add a row")')).toHaveCount(0);
  expect(await page.locator('#logrows tr.blank').count()).toBeGreaterThan(5);
});

/* ---- the time is stamped, and names are offered ---- */

test('clicking into a time box writes the time', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  await page.locator('#logrows tr.blank input[data-k="timein"]').first().click();
  const t = page.locator('#logrows tr.hand input[data-k="timein"]');
  await expect(t).toHaveValue(/^\d{4}$/);
  expect(await page.evaluate(() => DB.logs[0].timein)).toMatch(/^\d{4}$/);

  // and the time out the same way, on the row that now exists
  const out = page.locator('#logrows tr.hand input[data-k="timeout"]');
  await out.click();
  await expect(out).toHaveValue(/^\d{4}$/);
});

test('a time already written is never stamped over', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => { DB.logs = []; go('log'); });
  await page.locator('#logrows tr.blank input[data-k="timein"]').first().fill('0415');
  const t = page.locator('#logrows tr.hand input[data-k="timein"]');
  await expect(t).toHaveValue('0415');
  await t.click();
  await expect(t).toHaveValue('0415');            // the click did not restamp it
});

test('carriers and vendors are offered from the schedule the office uploaded',
  async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => {
    DB.orders = [
      { date:isoToday(), order:'1', carrier:'DAY&ROSS', vendor:'MCCAIN CA: CARBERRY' },
      { date:isoToday(), order:'2', carrier:'ARNOLD BROS', vendor:'PACTIV LLC' },
      { date:isoToday(), order:'3', carrier:'DAY&ROSS', vendor:'PACTIV LLC' },
    ];
    DB.logs = []; go('log');
  });
  const carriers = await page.locator('#dl_carrier option').evaluateAll(
    els => els.map(e => e.value));
  expect(carriers).toEqual(['ARNOLD BROS', 'DAY&ROSS']);      // sorted, no repeats
  const vendors = await page.locator('#dl_vendor option').evaluateAll(
    els => els.map(e => e.value));
  expect(vendors).toEqual(['MCCAIN CA: CARBERRY', 'PACTIV LLC']);

  // the log's carrier box draws on them, and still takes free text
  const cell = page.locator('#logrows tr.blank input[data-k="carrier"]').first();
  await expect(cell).toHaveAttribute('list', 'dl_carrier');
  await expect(cell).toHaveAttribute('aria-autocomplete', 'both');
  await cell.fill('SOME CARRIER NOT ON THE LIST');
  expect(await page.evaluate(() => DB.logs[0].carrier)).toBe('SOME CARRIER NOT ON THE LIST');
});

test('the seal form is offered the same names', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => {
    DB.orders = [{ date:isoToday(), order:'1', carrier:'GENEVA', vendor:'MULLINS FOOD PRODUCTS' }];
    renderSched(); go('form');
  });
  await expect(page.locator('#f_carrier')).toHaveAttribute('list', 'dl_carrier');
  await expect(page.locator('#f_vendor')).toHaveAttribute('list', 'dl_vendor');
  const v = await page.locator('#dl_vendor option').evaluateAll(els => els.map(e => e.value));
  expect(v).toContain('MULLINS FOOD PRODUCTS');
});
