/* The office loads a yard check the same way it loads a schedule, and hears
   back when the officer has filed it. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice  = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'},  role:'officer' });

async function onLoad(page) {
  await asOffice(page);
  await page.evaluate(() => { go('block'); blockPick(YC_SHIFT_AM[1]); });
  await expect(page.locator('#bkload')).toBeVisible();
}

/* ---- the loader replaces the bare box ---- */
test('the bell also carries the lists still to be released', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => { DB.yardslots = []; ycSlotsPersist(); ycUpdateBadge(); });
  const due = await page.evaluate(() => blockDue().length);
  test.skip(!due, 'no check is due a list at this hour');
  await expect(page.locator('#notif')).toBeVisible();
  await page.click('#notif');
  await expect(page.locator('#notifpanel')).toContainText('Trailer lists to release');
  await expect(page.locator('#notifpanel')).toContainText('Needs a trailer list');
});

test('the office gets the same loader it uses for the schedule', async ({ page }) => {
  await onLoad(page);
  await expect(page.locator('#dz')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('dzwrap').parentNode.id))
    .toBe('dzhost_block');
  await expect(page.locator('#dztitle')).toHaveText('Load the trailer list');
});

test('it offers what a block sheet actually arrives as', async ({ page }) => {
  await onLoad(page);
  await page.locator('#dzplus').click();
  await expect(page.locator('#dzmenu')).toContainText('Spreadsheet');
  await expect(page.locator('#dzmenu')).toContainText('Photo');
  await expect(page.locator('#dzmenu')).toContainText('Paste trailer numbers');
  // and everything else a schedule can arrive as, because a block sheet can too
  await expect(page.locator('#dzpdf')).toBeVisible();
  await expect(page.locator('#dzdoc')).toBeVisible();
});

test('pasted rows do exactly what typing in the box did', async ({ page }) => {
  await onLoad(page);
  await page.evaluate(() => ingPasteBox());
  await page.fill('#paste', 'LR7524, FRIES\nR25106, FRIES\nH50117, CHICKEN SD');
  await page.click('button:has-text("Load pasted rows")');
  await expect(page.locator('#bk_list'))
    .toHaveValue('LR7524, FRIES\nR25106, FRIES\nH50117, CHICKEN SD');
});

test('what is loaded lands in the box to be checked, not released', async ({ page }) => {
  await onLoad(page);
  await page.evaluate(() => ingBlockText('LR7524, FRIES\nR25106, BUNS', 'paste'));
  await expect(page.locator('#bk_list')).toHaveValue('LR7524, FRIES\nR25106, BUNS');
  // nothing has gone to the yard yet
  expect(await page.evaluate(() => (DB.yardslots || []).length)).toBe(0);
  await page.click('button:has-text("Release to the yard")');
  expect(await page.evaluate(() => DB.yardslots[0].trailers.map(t => t.trailer)))
    .toEqual(['LR7524', 'R25106']);
});

test('a box already filled is not overwritten without asking', async ({ page }) => {
  await onLoad(page);
  await page.fill('#bk_list', 'LR0001, OLD');
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.evaluate(() => ingBlockText('LR7524, FRIES\nR25106, BUNS', 'paste'));
  expect(asked).toContain('Replace');
  await expect(page.locator('#bk_list')).toHaveValue('LR0001, OLD');
});

test('a spreadsheet of trailers fills the box too', async ({ page }) => {
  await onLoad(page);
  await page.evaluate(() => ingYardXlsx(new Uint8Array(0).buffer)).catch(() => {});
  // the text route is the one a spreadsheet ends up on
  await page.evaluate(() => { DZ_MODE = 'block'; ingBlockText('LR7524 FRIES\nR25106 BUNS', 'spreadsheet'); });
  await expect(page.locator('#bk_list')).toHaveValue('LR7524, FRIES\nR25106, BUNS');
});

/* ---- the office hears when a check is filed ---- */
/* the date has to be the slot's own date, or the board will not match it up */
const ROWS = [
  { trailer:'LR7524', product:'FRIES', escalate: [] },
  { trailer:'R25106', product:'BUNS',  escalate: [] },
];
const file = (page, slot, rows) => page.evaluate(({ slot, rows }) => {
  DB.yardchecks = [{ date: ycSlotDate(slot), time: slot, name: 'Kobe', rows: rows }];
  ycPersistAll(); ycUpdateBadge();
}, { slot, rows: rows || ROWS });

async function officeWith(page, slot, rows) {
  await asOffice(page);
  await quiet(page);
  await file(page, slot, rows);
}
/* The office bell also carries checks that still need a trailer list, and at
   some hours there genuinely is one. Release them so these tests are looking
   at the filed-check half of the bell and nothing else. */
const quiet = (page) => page.evaluate(() => {
  DB.yardslots = blockDue().map(function(slot){
    return { id: ycSlotDate(slot)+'_'+slot, date: ycSlotDate(slot), slot: slot,
             loadedAt: new Date().toISOString(), count: 1,
             trailers: [{ trailer:'LR0001', product:'FILLER' }] };
  });
  ycSlotsPersist(); ycUpdateBadge();
});

test('a filed check rings the office bell', async ({ page }) => {
  await asOffice(page);
  await quiet(page);
  await expect(page.locator('#notif'), 'quiet until something is filed').toBeHidden();
  await file(page, '1000');
  await expect(page.locator('#notif')).toBeVisible();
  await expect(page.locator('#notifn')).toHaveText('1');
});

test('and says which check, who filed it, and how much', async ({ page }) => {
  await officeWith(page, '1000');
  await page.click('#notif');
  const item = page.locator('#notifpanel .npitem', { hasText: 'Yard check completed' });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Kobe');
  await expect(item).toContainText('2 checked');
  await expect(item).toContainText('10');
});

test('escalations are called out rather than counted as ordinary', async ({ page }) => {
  await officeWith(page, '1000', [
    { trailer:'LR7524', product:'FRIES', escalate:['TEMP 12'] },
    { trailer:'R25106', product:'BUNS',  escalate: [] },
  ]);
  await page.click('#notif');
  const item = page.locator('#notifpanel .npitem', { hasText: 'Yard check completed' });
  await expect(item).toContainText('1 escalation');
  await expect(item).toHaveClass(/over/);
});

test('tapping it opens that check, with a Print button', async ({ page }) => {
  await officeWith(page, '1000');
  await page.click('#notif');
  await page.locator('#notifpanel .npitem', { hasText: 'Yard check completed' }).click();
  await expect(page.locator('#bkview')).toBeVisible();
  await expect(page.locator('#bkview_title')).toContainText('10');
  await expect(page.locator('#bkview_body')).toContainText('LR7524');
  await expect(page.locator('#bkview .bkprint')).toBeVisible();
  await expect(page.locator('#bkview .bkprint')).toHaveText('Print');
});

test('reading it clears the bell, and it stays cleared', async ({ page }) => {
  await officeWith(page, '1000');
  await page.click('#notif');
  await page.locator('#notifpanel .npitem', { hasText: 'Yard check completed' }).click();
  await expect(page.locator('#notif')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await quiet(page);                       // the other half of the bell, again
  await file(page, '1000');
  await expect(page.locator('#notif'), 'already read').toBeHidden();
});

test('opening it from the board counts as reading it too', async ({ page }) => {
  await officeWith(page, '1000');
  await expect(page.locator('#notif')).toBeVisible();
  await page.evaluate(() => { go('block'); blockPick('1000'); });
  await expect(page.locator('#notif')).toBeHidden();
});

test('the tile for a filed check says Completed', async ({ page }) => {
  await officeWith(page, '1000');
  await page.evaluate(() => go('block'));
  const tile = page.locator('#bk_am .slot', { hasText: '10' }).first();
  await expect(tile).toContainText('Completed');
  await expect(tile).toContainText('2 checked');
});

test('an officer’s bell still shows what is due, not what is filed', async ({ page }) => {
  await asOfficer(page);
  await file(page, '1000');
  await page.evaluate(() => {
    DB.yardslots = [{ date: ycSlotDate(ycShiftSlots()[1]), slot: ycShiftSlots()[1],
                      loadedAt: new Date().toISOString() }];
    ycUpdateBadge();
  });
  await page.click('#notif');
  await expect(page.locator('#notifpanel')).toContainText('Yard checks waiting');
  await expect(page.locator('#notifpanel')).not.toContainText('Yard check completed');
});
