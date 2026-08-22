const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice  = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'},  role:'officer' });

test('the login screen never asks which role you are', async ({ page }) => {
  await H.gotoApp(page);                       // signed out
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#login select')).toHaveCount(0);
  await expect(page.locator('#login')).not.toContainText('Role');
  await expect(page.locator('#login')).not.toContainText('Office');
  await expect(page.locator('#login')).not.toContainText('Officer');
  // still just the two fields
  await expect(page.locator('#lg_email')).toBeVisible();
  await expect(page.locator('#lg_pass')).toBeVisible();
});

test('the account decides where you land', async ({ page }) => {
  await asOfficer(page);
  await expect(page.locator('#sec-home')).toBeVisible();
  await expect(page.locator('#sec-office')).toBeHidden();
  await expect(page.locator('#sec-home .tile', { hasText: 'Yard' })).toHaveCount(1);
});

test('the receiving office lands on its own screen', async ({ page }) => {
  await asOffice(page);
  await expect(page.locator('#sec-office')).toBeVisible();
  await expect(page.locator('#sec-home')).toBeHidden();
  await expect(page.locator('#sec-office')).toContainText('Schedule');
  await expect(page.locator('#sec-office')).toContainText('Trailer blocks');
});

test('a role cannot walk into the other role’s screens', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('yard'));
  await expect(page.locator('#sec-yard'), 'office must not reach the yard board').toBeHidden();
  await expect(page.locator('#sec-office')).toBeVisible();

  await asOfficer(page);
  await page.evaluate(() => go('block'));
  await expect(page.locator('#sec-block'), 'officer must not reach block release').toBeHidden();
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('the office releases a block and the officer is told', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="block"]');
  await expect(page.locator('#sec-block')).toBeVisible();
  const slot = await page.evaluate(() => $('bk_slot').value);
  await page.fill('#bk_list', 'LR7524 FRIES\nR25106 FRIES\nH50117 CHICKEN');
  await page.click('button:has-text("Release to the yard")');
  await expect(page.locator('#toast')).toContainText('3 trailers');
  const rec = await page.evaluate((s) => ycSlotRecord(s), slot);
  expect(rec.count).toBe(3);
  expect(rec.trailers[0]).toEqual({ trailer:'LR7524', product:'FRIES' });
  expect(rec.loadedBy).toBe('office@martinbrower.com');
  await expect(page.locator('#bk_hist')).toContainText('3 trailers');
});

test('a released block turns the officer’s card Ready', async ({ page }) => {
  await asOfficer(page);
  const st = await page.evaluate(() => {
    const slot = ycShiftSlots()[2];
    DB.yardslots = [{ date: ycSlotDate(slot), slot, loadedAt: new Date().toISOString(),
                      count: 3, trailers: [{trailer:'LR7524',product:'FRIES'}] }];
    return ycSlotStatus(slot);
  });
  expect(st.top).toBe('Ready to start');
  expect(st.bandR ?? st.detail).toContain('3 trailers');
});

test('the released trailers are already on the officer’s sheet', async ({ page }) => {
  await asOfficer(page);
  await page.click('.tile[onclick*="yard"]');
  await page.evaluate(() => {
    const slot = ycShiftSlots()[2];
    DB.yardslots = [{ date: ycSlotDate(slot), slot, loadedAt: new Date().toISOString(), count: 3,
      trailers: [{trailer:'LR7524',product:'FRIES'},
                 {trailer:'R25106',product:'FRIES'},
                 {trailer:'H50117',product:'CHICKEN'}] }];
    renderYardSlots();
  });
  await page.click('#ycslots .slot >> nth=2');
  const rows = page.locator('#ycrows table tr');
  await expect(rows.nth(1).locator('input').first()).toHaveValue('LR7524');
  await expect(rows.nth(2).locator('input').first()).toHaveValue('R25106');
  await expect(rows.nth(3).locator('input').first()).toHaveValue('H50117');
  // products came across too, temps are the officer's to fill
  await expect(rows.nth(1).locator('input').nth(1)).toHaveValue('FRIES');
  await expect(rows.nth(1).locator('input').nth(3)).toHaveValue('');
});

test('work already typed is never overwritten by a block', async ({ page }) => {
  await asOfficer(page);
  await page.click('.tile[onclick*="yard"]');
  await page.evaluate(() => {
    const slot = ycShiftSlots()[2];
    DB.yardslots = [{ date: ycSlotDate(slot), slot, loadedAt: new Date().toISOString(), count: 1,
      trailers: [{trailer:'LR7524',product:'FRIES'}] }];
    renderYardSlots();
  });
  await page.click('#ycslots .slot >> nth=2');
  await page.evaluate(() => { YC.rows[0].temp = '-9.9'; ycSaveDraft(); });
  await page.goBack();
  await page.click('#ycslots .slot >> nth=2');          // same slot again
  await expect(page.locator('#ycrows table tr').nth(1).locator('input').nth(3)).toHaveValue('-9.9');
});

test('the trailer list parses trailer and product per line', async ({ page }) => {
  await asOffice(page);
  const r = await page.evaluate(() => blockParse(
    'LR7524 FRIES\n r25106,  fries \nH50117\tCHICKEN\n\nLR7524 DUPLICATE\n'));
  expect(r).toEqual([
    { trailer:'LR7524', product:'FRIES' },
    { trailer:'R25106', product:'FRIES' },
    { trailer:'H50117', product:'CHICKEN' },
  ]);
});

/* ---- the office schedule: upload, correct, preview, submit ---- */
const TSV = [
  'Date\tZone\tPriority\tDetail\tTime\tIn Yard\tOrder Number\tVendor Name\tAppointment Carrier\tContact Name\tOpen Cases\tPallets',
  '2026-08-21\tF\t\tDROP\t700\tN\t8036385\tMCCAIN CA: CARBERRY\tDAY&ROSS\t\t1134\t21',
  '2026-08-21\tF\t*\tLIVE\t1100\tN\t8049721\tINTERSTATE WAREHOUSING\tK&B TRANS\t\t1026\t19',
  '2026-08-21\tR\t*\tLIVE\t1030\tN\t8061227\tTAYLOR FARMS TENNESSEE INC\tTAYLOR FARMS\tCFA-ARMADA\t910\t15',
].join('\n');

test('the office has no photo import', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await expect(page.locator('#sec-sched')).not.toContainText('photo');
  await expect(page.locator('button:has-text("Upload spreadsheet")')).toBeVisible();
  await expect(page.locator('button:has-text("Or paste from a spreadsheet")')).toBeVisible();
  const accept = await page.locator('#file').getAttribute('accept');
  expect(accept, 'images must not be accepted').not.toContain('image');
});

test('pasted spreadsheet rows land in an editable grid, not straight into the yard', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');

  await expect(page.locator('#draftcard')).toBeVisible();
  await expect(page.locator('#draftcnt')).toHaveText('(3)');
  const rows = page.locator('#draftgrid table tr');
  await expect(rows).toHaveCount(5);          // column letters + header + 3 data rows
  const first = rows.nth(2);
  await expect(first.locator('input').nth(6)).toHaveValue('8036385');
  await expect(first.locator('input').nth(7)).toHaveValue('MCCAIN CA: CARBERRY');
  // nothing published yet
  expect(await page.evaluate(() => (window.__fb.written || []).length)).toBe(0);
});

test('the office can correct a row before submitting', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');
  const vendor = page.locator('#draftgrid table tr').nth(2).locator('input').nth(7);
  await vendor.fill('MCCAIN CA: CARBERRY (CORRECTED)');
  await page.click('button:has-text("Preview")');
  await expect(page.locator('#schedpreview')).toContainText('CORRECTED');
});

test('the preview is the printed sheet, with totals', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');
  await page.click('button:has-text("Preview")');

  const prn = page.locator('#schedpreview');
  await expect(prn).toContainText('MARTIN BROWER, Inc. Confidential');
  await expect(prn).toContainText('Friday, August 21, 2026');
  for (const h of ['Zones','Detail','Time','In Yard','Order Number','Vendor Name',
                   'Appointment Carrier','Contact Name','Open Cases','Pallets'])
    await expect(prn.locator('th', { hasText: h }).first()).toHaveCount(1);
  await expect(prn).toContainText('3,070');      // 1134 + 1026 + 910
  await expect(prn).toContainText('55');         // 21 + 19 + 15
  await expect(prn).toContainText('★');          // priority marks
});

test('submit is only offered after a preview, and publishes what was previewed', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');
  await expect(page.locator('#schedactions')).toBeHidden();

  await page.click('button:has-text("Preview")');
  await expect(page.locator('#schedactions')).toBeVisible();

  await page.click('button:has-text("Submit to the yard")');
  // published to the shared schedule, not just held locally
  const written = await page.evaluate(() => window.__fb.written || []);
  expect(written.length).toBe(3);
  expect(written.map(o => o.order).sort()).toEqual(['8036385','8049721','8061227']);
  expect(written.find(o => o.order === '8061227').vendor).toBe('TAYLOR FARMS TENNESSEE INC');
  await expect(page.locator('#draftcard')).toBeHidden();
});

test('editing after a preview forces another look before submitting', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');
  await page.click('button:has-text("Preview")');
  await expect(page.locator('#schedactions')).toBeVisible();
  await page.locator('#draftgrid table tr').nth(2).locator('input').nth(4).fill('815');
  await expect(page.locator('#schedactions'), 'a change must invalidate the preview').toBeHidden();
});

test('officers cannot load the schedule at all', async ({ page }) => {
  await asOfficer(page);
  await page.click('#sec-home .tile[onclick*="sched"]');
  await expect(page.locator('button:has-text("Upload spreadsheet")')).toBeHidden();
  await expect(page.locator('button:has-text("Clear all schedule data")')).toBeHidden();
  await expect(page.locator('#sched')).toBeVisible();      // but they still read it
});

/* ---- deep links ---- */
test('a hash in the URL actually opens that screen', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.goto('/index.html#sched');
  await page.waitForFunction(() => window.__fb && window.__fb.settled);
  await expect(page.locator('#sec-sched')).toBeVisible();
  await expect(page.locator('#sec-home'), 'the home tiles must not be what you see').toBeHidden();
});

test('the office is moved off an officer screen even when deep linked', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.goto('/index.html#yard');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await expect(page.locator('#sec-office')).toBeVisible();
  await expect(page.locator('#sec-yard')).toBeHidden();
});

test('the office deep linked to the officer home is moved to its own', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.goto('/index.html#home');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await expect(page.locator('#sec-office')).toBeVisible();
  await expect(page.locator('#sec-home')).toBeHidden();
});

test('the office deep linked to the schedule stays on the schedule', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(H.FB_STUB, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.goto('/index.html#sched');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await expect(page.locator('#sec-sched')).toBeVisible();
  await expect(page.locator('button:has-text("Upload spreadsheet")')).toBeVisible();
});

test('the grid looks like the spreadsheet it came from', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');

  // column letters across the top, row numbers down the left
  const letters = page.locator('#draftgrid table tr.dgcols th');
  await expect(letters.nth(1)).toHaveText('A');
  await expect(letters.nth(2)).toHaveText('B');
  const rows = page.locator('#draftgrid table tr');
  await expect(rows.nth(1).locator('.gut').first()).toHaveText('1');    // header is row 1
  await expect(rows.nth(2).locator('.gut').first()).toHaveText('2');

  // both header rows stay put while the grid scrolls
  for (const sel of ['tr.dgcols th', 'tr.dghdr th']) {
    const pos = await page.locator('#draftgrid table ' + sel).first()
      .evaluate(el => getComputedStyle(el).position);
    expect(pos, sel + ' should be frozen').toBe('sticky');
  }
  const gut = await page.locator('#draftgrid table .gut').first()
    .evaluate(el => getComputedStyle(el).position);
  expect(gut, 'the row-number gutter should be frozen').toBe('sticky');
});

test('each day is tinted differently, as in the spreadsheet', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV.replace(/2026-08-21\t(R)/, '2026-08-22\t$1'));
  await page.click('button:has-text("Load pasted rows")');
  const tints = await page.evaluate(() =>
    [...document.querySelectorAll('#draftgrid table tr.d0 td, #draftgrid table tr.d1 td')]
      .slice(0, 1).map(td => getComputedStyle(td).backgroundColor));
  expect(tints.length).toBe(1);
  const classes = await page.evaluate(() =>
    [...document.querySelectorAll('#draftgrid table tr')].map(r => r.className).filter(Boolean));
  expect(classes).toContain('d0');
  expect(classes, 'a second day should get its own tint').toContain('d1');
});

test('the office gets the full window, officers keep the narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  const officeW = await page.locator('main').evaluate(el => el.getBoundingClientRect().width);
  expect(officeW, 'the office schedule should use the window').toBeGreaterThan(1000);

  await asOfficer(page);
  await page.click('#sec-home .tile[onclick*="sched"]');
  const officerW = await page.locator('main').evaluate(el => el.getBoundingClientRect().width);
  expect(officerW, 'officers keep the phone-friendly width').toBeLessThanOrEqual(660);
});

test('after submitting, the office sees the printed sheet, not a list', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');
  await page.click('button:has-text("Preview")');
  const sent = await page.evaluate(() => JSON.parse(JSON.stringify(SCHED_DRAFT)));
  await page.click('button:has-text("Submit to the yard")');
  // the published rows return through the sync; stand them in so we can render
  await page.evaluate((rows) => { DB.orders = rows; renderSched(); }, sent);
  const sched = page.locator('#sched');
  await expect(sched).toContainText('MARTIN BROWER, Inc. Confidential');
  await expect(sched).toContainText('Friday, August 21, 2026');
  await expect(sched.locator('.schedrow'), 'the plain list should be gone').toHaveCount(0);
});

test('the grid header is a table row, not the app header bar', async ({ page }) => {
  await asOffice(page);
  await page.click('#sec-office .tile[onclick*="sched"]');
  await page.click('button:has-text("Or paste from a spreadsheet")');
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');
  // a class collision with the app header once made this row display:grid
  const d = await page.evaluate(() => ({
    row: getComputedStyle(document.querySelector('#draftgrid table tr.dghdr')).display,
    cell: getComputedStyle(document.querySelector('#draftgrid table tr.dghdr th:nth-child(2)')).display,
  }));
  expect(d.row).toBe('table-row');
  expect(d.cell).toBe('table-cell');
  // and the header cells line up with the columns beneath them
  const m = await page.evaluate(() => {
    const h = document.querySelector('#draftgrid table tr.dghdr th:nth-child(8)').getBoundingClientRect();
    const c = document.querySelector('#draftgrid table tr:nth-child(3) td:nth-child(8)').getBoundingClientRect();
    return { hx: h.x, cx: c.x, hw: h.width, cw: c.width };
  });
  expect(Math.abs(m.hx - m.cx), 'header cell is not above its column').toBeLessThan(2);
  expect(Math.abs(m.hw - m.cw), 'header cell width does not match its column').toBeLessThan(2);
});
