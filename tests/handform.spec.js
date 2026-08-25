/* An officer may photograph the COMPLETED form - the check done in pen - not
   just the trailer list. The reader takes the readings off it and fills the
   whole check; the officer reads it over and submits, one tap. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
const parse = (page, text) => page.evaluate((t) => ycParseTrailers(t), text);

test('a completed row is read whole: set, temp, fuel, Y/N, door', async ({ page }) => {
  await asOfficer(page);
  const rows = await parse(page, 'LR7524 FRIES -10 -9.1 FULL Y 20');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ trailer:'LR7524', product:'FRIES', set:'-10',
    temp:'-9.1', fuel:'FULL', intact:'Y', door:'20' });
});

test('a plain trailer list still reads as just the list', async ({ page }) => {
  await asOfficer(page);
  const rows = await parse(page, 'LR7524 FRIES\nR25106 BUNS');
  expect(rows).toHaveLength(2);
  expect(rows[0].temp).toBe('');
  expect(rows[0].fuel).toBe('');
});

test('OFF in pen dashes the rest of the row, as it does on screen', async ({ page }) => {
  await asOfficer(page);
  const rows = await parse(page, 'R25106 BUNS OFF');
  expect(rows[0].set).toBe('OFF');
  expect(rows[0].temp).toBe('—');
  expect(rows[0].fuel).toBe('—');
});

test('a cooler row, a fraction of fuel, and an N/A door all land', async ({ page }) => {
  await asOfficer(page);
  const rows = await parse(page, 'H50117 CHICKEN SD 34 36.0 3/4 N N/A');
  expect(rows[0]).toMatchObject({ set:'34', temp:'36.0', fuel:'3/4',
    intact:'N', door:'N/A' });
});

test('a token that fits nothing is skipped, never guessed at', async ({ page }) => {
  await asOfficer(page);
  // the scrawl "%(" between temp and fuel must not become a reading
  const rows = await parse(page, 'LR7524 FRIES -10 -9.1 XX999XX FULL Y 20');
  expect(rows[0].temp).toBe('-9.1');
  expect(rows[0].fuel).toBe('FULL');
});

test('a blank column on the paper does not shift every reading after it', async ({ page }) => {
  await asOfficer(page);
  // no fuel written: Y and 20 still land as intact and door
  const rows = await parse(page, 'LR7524 FRIES -10 -9.1 Y 20');
  expect(rows[0].intact).toBe('Y');
  expect(rows[0].door).toBe('20');
  expect(rows[0].fuel).toBe('');
});

test('a pen Y read as V is still a Y', async ({ page }) => {
  await asOfficer(page);
  const rows = await parse(page, 'LR7524 FRIES -10 -9.1 FULL V 20');
  expect(rows[0].intact).toBe('Y');
});

test('a temperature without its decimal stays blank for the officer', async ({ page }) => {
  await asOfficer(page);
  // promoting whole numbers turned OCR debris into temperatures on a real
  // photo, so a reading is a reading only with its point on it
  const rows = await parse(page, 'LR7524 FRIES -10 -9 FULL Y 20');
  expect(rows[0].temp).toBe('');
  expect(rows[0].fuel, 'the later readings still land').toBe('FULL');
});

test('the band follows the set point that was read', async ({ page }) => {
  await asOfficer(page);
  const rows = await parse(page, 'LR7524 FRIES -10 -9.1 FULL Y 20\nH50117 MILK 34 36.0 FULL Y 2');
  expect(rows[0].type).toBe('FROZEN');
  expect(rows[1].type).toBe('COOLER');
});

test('an out-of-range reading on the paper is an escalation on the screen', async ({ page }) => {
  await asOfficer(page);
  const esc = await page.evaluate(() => {
    const rows = ycParseTrailers('LR7524 FRIES -10 2.1 FULL Y 20');
    return ycEval(rows[0]);
  });
  expect(esc.join(' ')).toContain('TEMP OUT OF RANGE');
});

/* ---- the whole journey: photo lands filled in, goes to the sheet ---- */
async function landHand(page, text) {
  await asOfficer(page);
  await page.evaluate((t) => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    // the same landing the photo reader uses, fed the OCR text directly
    YC.rows = ycParseTrailers(t);
    ycSaveDraft(); renderYard(); renderYcGrid();
    var hand = ycHandCount(YC.rows);
    if (hand >= Math.max(1, Math.ceil(YC.rows.length / 2))) go('yardsheet', false, YC.time);
  }, text);
}

test('a completed form goes straight to the review sheet, filled in', async ({ page }) => {
  await landHand(page, 'LR7524 FRIES -10 -9.1 FULL Y 20\nR25106 BUNS OFF\nH50117 MILK 34 36.0 1/2 Y 4');
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
  const vals = await page.evaluate(() => YC.rows.map(r => [r.trailer, r.temp, r.fuel]));
  expect(vals).toEqual([['LR7524','-9.1','FULL'], ['R25106','—','—'], ['H50117','36.0','1/2']]);
  // every row reads as done: submitting is one look and one tap
  expect(await page.evaluate(() => YC.rows.every(r => ycRowDone(r)))).toBe(true);
});

test('a bare list still lands on the grid to be worked through', async ({ page }) => {
  await landHand(page, 'LR7524 FRIES\nR25106 BUNS');
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
  await expect(page.locator('#sec-yardsheet')).toBeHidden();
});

test('nothing is submitted by the photo itself', async ({ page }) => {
  await landHand(page, 'LR7524 FRIES -10 -9.1 FULL Y 20');
  expect(await page.evaluate(() => (window.__fb.written || []).length),
    'the officer reads it over first; Submit stays theirs').toBe(0);
});

/* ---- what went wrong with the first real photo ---- */
test('the preprocessor keeps the ink on a yard photo', async ({ page }) => {
  await asOfficer(page);
  const px = await page.evaluate(() => {
    // one blue-pen pixel on paper: stripped for a schedule, kept for a check
    const mk = () => {
      const cv = document.createElement('canvas'); cv.width = 2; cv.height = 1;
      const g = cv.getContext('2d');
      g.fillStyle = 'rgb(40,62,190)'; g.fillRect(0, 0, 1, 1);   // blue biro
      g.fillStyle = 'rgb(246,244,238)'; g.fillRect(1, 0, 1, 1); // paper
      return cv;
    };
    const read = (cv) => cv.getContext('2d').getImageData(0, 0, 1, 1).data[0];
    const sched = preprocess(mk());          // schedule: pen comes off
    const check = preprocess(mk(), true);    // completed check: pen is the data
    return { sched: read(sched), check: read(check) };
  });
  expect(px.sched, 'a schedule strips the pen').toBe(255);
  expect(px.check, 'a check must not erase its own answers').not.toBe(255);
});

test('products come from the released list, not from the OCR', async ({ page }) => {
  await asOfficer(page);
  const rows = await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = [{ id: ycSlotDate(slot)+'_'+slot, date: ycSlotDate(slot), slot,
      loadedAt: new Date().toISOString(), count: 3, trailers: [
        { trailer:'LR7524', product:'FRIES' },
        { trailer:'R25106', product:'BUNS' },
        { trailer:'H50117', product:'CHICKEN SD' },
      ]}];
    ycSlotsPersist(); YC = null; YC_VIEW = null; go('ycgrid', false, slot);
    // OCR read the numbers, garbled one, missed every product, missed a row
    const got = ycParseTrailers('LR7524 -10 -9.1 FULL Y 20\nR25I06 34 36.0 1/2 N 4');
    return ycMergeReleased(got, slot).map(r => [r.trailer, r.product, r.temp]);
  });
  expect(rows).toEqual([
    ['LR7524', 'FRIES', '-9.1'],
    ['R25106', 'BUNS', '36.0'],       // the garbled I corrected from the list
    ['H50117', 'CHICKEN SD', ''],     // missed by the photo, still on the check
  ]);
});

/* ---- the officer who did not wait for the office at all ----
   No released list. The photo alone carries trailer numbers, product names
   and the pen. The check fills, the officer reads it over, and Submit pushes
   it to the receiving office. */
test('with no released list, the photo alone makes the whole check', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    let rows = ycParseTrailers([
      'LR7524 FRIES -10 -9.1 FULL Y 20',
      'R25I06 BUNS 34 36.0 1/2 Y 4',          // OCR's I for 1
      'H50117 CHICKEN SD OFF',
    ].join('\n'));
    rows = ycMergeReleased(rows, YC.time);     // no list: hands back untouched
    YC.rows = rows; ycSaveDraft(); renderYard(); renderYcGrid();
    if (ycHandCount(rows) >= Math.max(1, Math.ceil(rows.length / 2)))
      go('yardsheet', false, YC.time);
  });
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
  const rows = await page.evaluate(() => YC.rows.map(r => [r.trailer, r.product, r.temp, r.fuel]));
  expect(rows).toEqual([
    ['LR7524', 'FRIES', '-9.1', 'FULL'],
    ['R25106', 'BUNS', '36.0', '1/2'],
    ['H50117', 'CHICKEN SD', '—', '—'],
  ]);
  expect(await page.evaluate(() => YC.rows.every(r => ycRowDone(r))),
    'nothing left to fill in').toBe(true);
});

test('and Submit pushes it to the receiving office', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    YC.rows = ycParseTrailers('LR7524 FRIES -10 -9.1 FULL Y 20');
    ycSaveDraft(); go('yardsheet', false, YC.time);
  });
  page.once('dialog', d => d.accept());
  await page.click('#sec-yardsheet button:has-text("Submit to receiving office")');
  await page.waitForTimeout(300);
  const sent = await page.evaluate(() => (window.__fb.added || [])
    .filter(a => a.name === 'yardchecks').map(a => a.data.rows[0].trailer));
  expect(sent, 'on the record, for the office to read').toEqual(['LR7524']);
  await expect(page.locator('#sec-yard'), 'and the officer is back on the board').toBeVisible();
});

/* ---- a photo that came out badly is thrown away and taken again ---- */
test('Clear empties a check that had no released list', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    YC.rows = ycParseTrailers('LR7524 FRIES -10 -9.1 FULL Y 20');
    ycSaveDraft(); renderYcGrid();
  });
  page.once('dialog', d => d.accept());
  await page.click('.ycgclear');
  expect(await page.evaluate(() => YC.rows.length)).toBe(0);
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
});

test('Clear puts the released list back, unchecked', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = [{ id: ycSlotDate(slot)+'_'+slot, date: ycSlotDate(slot), slot,
      loadedAt: new Date().toISOString(), count: 2,
      trailers: [{trailer:'LR7524', product:'FRIES'}, {trailer:'R25106', product:'BUNS'}] }];
    ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    YC.rows.forEach(r => { r.set='-10'; r.temp='0.5'; r.fuel='FULL'; r.intact='Y'; });
  });
  page.once('dialog', d => d.accept());
  await page.click('.ycgclear');
  const rows = await page.evaluate(() => YC.rows.map(r => [r.trailer, r.product, r.temp]));
  expect(rows).toEqual([['LR7524','FRIES',''], ['R25106','BUNS','']]);
});

test('dismissing the confirm clears nothing', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
    YC.rows = ycParseTrailers('LR7524 FRIES');
    ycSaveDraft(); renderYcGrid();
  });
  page.once('dialog', d => d.dismiss());
  await page.click('.ycgclear');
  expect(await page.evaluate(() => YC.rows.length)).toBe(1);
});

test('the sheet has the same way out', async ({ page }) => {
  await landHand(page, 'LR7524 FRIES -10 -9.1 FULL Y 20');
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.click('#sec-yardsheet button:has-text("Clear this check")');
  // nothing left, so the grid is where trailers are added
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
});

/* ---- the cell reader, on a form we draw ourselves ----
   A real photograph proves the idea but cannot anchor a test suite. This
   draws the printed form onto a canvas - grid, header, values - and reads it
   back through the whole pipeline: skew search, line detection, pitch, cell
   OCR with per-column alphabets. */
async function drawnForm(page, opts) {
  return page.evaluate(async (o) => {
    const cv = document.createElement('canvas');
    cv.width = 1600; cv.height = 1200;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1600, 1200);
    if (o.rotate) { g.translate(800, 600); g.rotate(o.rotate * Math.PI / 180); g.translate(-800, -600); }
    const left = 120, right = 1480, top = 220, rows = o.rows.length + 1, pitch = 90;
    const colr = [0, 0.113, 0.26, 0.39, 0.485, 0.563, 0.658, 0.744, 1];
    const cols = colr.map(r => Math.round(left + r * (right - left)));
    g.strokeStyle = '#111'; g.lineWidth = 3;
    for (let r = 0; r <= rows; r++) {
      g.beginPath(); g.moveTo(left, top + r * pitch); g.lineTo(right, top + r * pitch); g.stroke();
    }
    cols.forEach(x => { g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + rows * pitch); g.stroke(); });
    g.fillStyle = '#111'; g.font = 'bold 26px Arial';
    const put = (r, c, t) => g.fillText(t, cols[c] + 12, top + r * pitch + 58);
    ['TRAILER#','PRODUCT','SET','TEMP','FUEL','YN','DOOR'].forEach((h, c) => put(0, c, h));
    o.rows.forEach((vals, i) => vals.forEach((v, c) => v && put(i + 1, c, v)));
    // straighten the canvas back so the photo itself is what is rotated
    const out = document.createElement('canvas');
    out.width = 1600; out.height = 1200;
    out.getContext('2d').drawImage(cv, 0, 0);
    const worker = await getWorker();
    const bin = preprocess(out, true);
    const got = await ycGridRead(bin, worker);
    return got && got.map(r => [r.trailer, r.product, r.set, r.temp, r.fuel, r.intact, r.door]);
  }, opts);
}

const FORM_ROWS = [
  ['LR7524', 'FRIES', '-10', '-9.1', 'FULL', 'Y', '20'],
  ['R25106', 'BUNS', '34', '36.0', '3/4', 'N', '4'],
  ['H50117', 'CHICKEN', '-10', '-8.3', '1/2', 'Y', 'N/A'],
  ['57729', 'FE', 'OFF', '', '', '', ''],
];

test('the cell reader reads a straight form exactly', async ({ page }) => {
  test.setTimeout(120000);
  await asOfficer(page);
  const got = await drawnForm(page, { rows: FORM_ROWS });
  expect(got, 'the grid was not even found').not.toBeNull();
  expect(got.map(r => r[0])).toEqual(['LR7524', 'R25106', 'H50117', '57729']);
  expect(got[0]).toEqual(['LR7524', 'FRIES', '-10', '-9.1', 'FULL', 'Y', '20']);
  expect(got[1].slice(2)).toEqual(['34', '36.0', '3/4', 'N', '4']);
  expect(got[3][2], 'OFF read from the set cell').toBe('OFF');
  expect(got[3][3], 'and the rest of that row dashed').toBe('—');
});

test('two degrees of tilt is found and undone', async ({ page }) => {
  test.setTimeout(120000);
  await asOfficer(page);
  const got = await drawnForm(page, { rows: FORM_ROWS, rotate: 2 });
  expect(got).not.toBeNull();
  expect(got.map(r => r[0])).toEqual(['LR7524', 'R25106', 'H50117', '57729']);
  expect(got[0][3]).toBe('-9.1');
});

test('a page with no table falls back rather than failing', async ({ page }) => {
  await asOfficer(page);
  const got = await page.evaluate(() => {
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 600;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#111'; g.font = '24px Arial';
    g.fillText('LR7524 FRIES', 40, 100);
    return ycFindGrid(preprocess(cv, true));
  });
  expect(got, 'no grid: the line reader takes over').toBeNull();
});
