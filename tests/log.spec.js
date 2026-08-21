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
  await expect(page.locator('#logrows table tr')).toHaveCount(15);  // header + 14
  const cells = page.locator('#logrows table tr').nth(1);
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
  const rows = page.locator('#logrows table tr');
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
  const inputs = page.locator('#logrows table tr').nth(1).locator('input');
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
  await expect(heads).toHaveCount(9);
  await expect(heads.nth(0)).toHaveText('Time In');
  await expect(heads.nth(2)).toHaveText('Out Trailer Number');
  await expect(heads.nth(5)).toHaveText('Trailer Number');
  await expect(heads.nth(6)).toHaveText('Plate Number');
  await expect(heads.nth(8)).toHaveText('Notes');
  await expect(page.locator('#logrows')).not.toContainText('No trailers signed in');
  await expect(page.locator('#sec-log')).not.toContainText('A row is added automatically');
});
