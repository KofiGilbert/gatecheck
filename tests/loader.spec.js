/* One loader, moved to whichever screen is asking for a file. An officer with
   the printed sheet in their hand should not have to wait for the office, and
   a yard check's trailer list arrives the same way a schedule does. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const H = require('./helpers.js');

const asOffice  = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'},  role:'officer' });
const fixture   = (n) => path.join(__dirname, 'fixtures', n);

const TSV = [
  'Date\tZone\tOrder Number\tVendor Name\tAppointment Carrier\tOpen Cases\tPallets',
  '2026-09-04\tD\t80900011\tKRAFT\tSUNSET TRANS\t500\t9',
  '2026-09-04\tE\t80900012\tCOCA COLA\tMW LOGISTICS\t640\t11',
].join('\n');

/* ---- 1. the officer can load the schedule too ---- */
test('an officer holding the printed sheet can load it', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#dz')).toBeVisible();
  await expect(page.locator('#loadttl')).toHaveText('Load it yourself');
});

test('and is told plainly that their copy stays on the device', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#loadhint')).toContainText('stays on this device');
  await expect(page.locator('#loadhint')).toContainText('receiving office');
});

test('the office is told the opposite, because its copy is the team’s', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#loadttl')).toHaveText('Load the schedule');
  await expect(page.locator('#loadhint')).toContainText('Nothing goes to the yard');
});

test('an officer checks it in the same grid before it counts', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate(() => ingPasteBox());
  await page.fill('#paste', TSV);
  await page.click('button:has-text("Load pasted rows")');
  await expect(page.locator('#draftcard')).toBeVisible();
  await expect(page.locator('#draftgrid table.dg')).toBeVisible();
  expect(await page.evaluate(() => DB.orders.length), 'not live until submitted').toBe(0);
});

test('an officer submitting keeps it on the device, not on the team schedule', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate((t) => { ingPasteBox(); document.getElementById('paste').value = t; }, TSV);
  await page.click('button:has-text("Load pasted rows")');
  await page.click('button:has-text("Preview")');
  await page.click('#draftview button:has-text("Submit to the yard")');
  expect(await page.evaluate(() => DB.orders.length)).toBe(2);
  const written = await page.evaluate(() => window.__fb.written || []);
  expect(written, 'the officer must not write the team schedule').toEqual([]);
});

test('the office submitting still publishes to everyone', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate((t) => { ingPasteBox(); document.getElementById('paste').value = t; }, TSV);
  await page.click('button:has-text("Load pasted rows")');
  await page.click('button:has-text("Preview")');
  await page.click('#draftview button:has-text("Submit to the yard")');
  const written = await page.evaluate(() => window.__fb.written || []);
  expect(written.map(o => o.order).sort()).toEqual(['80900011', '80900012']);
});

test('a spreadsheet an officer drops lands in their draft', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  await page.setInputFiles('#file', fixture('schedule.docx'));
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#draftgrid input[value="80123456"]')).toHaveCount(1);
});

/* ---- 2. the same loader loads a yard check ---- */
async function onGrid(page) {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
  });
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
}

test('the yard check gets the same loader, moved to it', async ({ page }) => {
  await onGrid(page);
  await expect(page.locator('#dz')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('dzwrap').parentNode.id))
    .toBe('dzhost_yard');
  await expect(page.locator('#dztitle')).toHaveText('Load the trailer list');
});

test('it asks for what a trailer list actually arrives as', async ({ page }) => {
  await onGrid(page);
  await page.locator('#dzplus').click();
  const menu = page.locator('#dzmenu');
  await expect(menu.locator('button', { hasText: 'Spreadsheet' })).toBeVisible();
  await expect(menu.locator('button', { hasText: 'Photo' })).toBeVisible();
  await expect(menu).toContainText('Paste trailer numbers');
  // nobody sends a block sheet as a Word file
  await expect(page.locator('#dzpdf')).toBeHidden();
  await expect(page.locator('#dzdoc')).toBeHidden();
});

test('pasted trailer numbers become the check', async ({ page }) => {
  await onGrid(page);
  await page.evaluate(() => ingPasteBox());
  await page.fill('#paste', 'LR7524 FRIES\nLR7540 BUNS\nLR7601 BEEF');
  await page.click('button:has-text("Load pasted rows")');
  expect(await page.evaluate(() => YC.rows.map(r => r.trailer)))
    .toEqual(['LR7524', 'LR7540', 'LR7601']);
  await expect(page.locator('#ycgridwrap .ycgtile')).toHaveCount(4);   // three + Add
});

test('replacing a list already started asks first', async ({ page }) => {
  await onGrid(page);
  await page.evaluate(() => { ycLoadDraft(); YC.rows = [ycRowBlank()]; YC.rows[0].trailer = 'OLD1'; });
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.evaluate(() => ingYardText('LR7524 FRIES\nLR7540 BUNS', 'paste'));
  expect(asked).toContain('Replace');
  expect(await page.evaluate(() => YC.rows.map(r => r.trailer))).toEqual(['OLD1']);
});

test('a Word file is refused with a reason, not a silent nothing', async ({ page }) => {
  await onGrid(page);
  const msg = await page.evaluate(async () => {
    let said = ''; const real = window.toast; window.toast = (m) => { said = m; };
    await ingestFile(new File(['x'], 'block.docx'));
    window.toast = real; return said;
  });
  expect(msg).toContain('photo, a spreadsheet, or pasted text');
});

test('leaving the screen takes the loader with it', async ({ page }) => {
  await onGrid(page);
  await page.evaluate(() => go('home'));
  await expect(page.locator('#dz')).toBeHidden();
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#dz')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('dzwrap').parentNode.id))
    .toBe('dzhost_sched');
  await expect(page.locator('#dztitle')).toHaveText('Drop a file here, or press +');
});

test('the paste box does not follow the loader across screens', async ({ page }) => {
  await onGrid(page);
  await page.evaluate(() => ingPasteBox());
  await expect(page.locator('#pastebox')).toBeVisible();
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#pastebox')).toBeHidden();
});

/* ---- 3. the close button, and everything else a finger has to hit ---- */
test('the paste box closes when the x is pressed', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate(() => ingPasteBox());
  await expect(page.locator('#pastebox')).toBeVisible();
  await page.locator('.pbclose').click();
  await expect(page.locator('#pastebox')).toBeHidden();
});

test('the x is big enough for a finger to land on', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await page.evaluate(() => ingPasteBox());
  const b = await page.locator('.pbclose').boundingBox();
  expect(b.width, 'width').toBeGreaterThanOrEqual(44);
  expect(b.height, 'height').toBeGreaterThanOrEqual(44);
});

test('every button an officer taps is at least 44 across', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    DB.orders = [{ date:isoToday(), zone:'D', order:'8040001', vendor:'A', cases:9, pallets:1 }];
    persist();
  });
  const small = [];
  for (const sec of ['home','sched','yard','log','dar','hist','settings','form']) {
    await page.evaluate((s) => go(s), sec);
    const bad = await page.evaluate((s) => {
      const out = [];
      document.querySelectorAll('section.on button, #dzwrap:not([hidden]) button')
        .forEach(el => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;                 // hidden
          if (getComputedStyle(el).display === 'none') return;
          if (r.height < 44 || r.width < 44)
            out.push(s + ': ' + (el.className || el.id || el.textContent.trim().slice(0, 14))
              + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        });
      return out;
    }, sec);
    small.push(...bad);
  }
  expect(small, 'Apple asks for 44x44; a finger is about that wide').toEqual([]);
});
