const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* The officer works a check one trailer at a time: tabs for the trailers the
   office released, a card per trailer, then the whole sheet to read before it
   goes anywhere. */

const asOfficer = (p) => H.gotoApp(p, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
const asOffice  = (p) => H.gotoApp(p, { user:{email:'office@martinbrower.com'}, role:'office' });

const TRAILERS = [
  { trailer:'57775',  product:'FE' },
  { trailer:'LR7502', product:'FRIES' },
  { trailer:'LR7611', product:'FRIES' },
];

/* release a block the way the receiving office does */
async function released(page, trailers) {
  return await page.evaluate((trailers) => {
    const slot = ycShiftSlots()[2];
    const date = ycSlotDate(slot);
    DB.yardslots = [{ id: date+'_'+slot, date, slot, loadedAt: new Date().toISOString(),
                      loadedBy:'office@martinbrower.com',
                      count: trailers.length, trailers }];
    ycSlotsPersist();
    return slot;
  }, trailers || TRAILERS);
}
async function openGrid(page, trailers) {
  const slot = await released(page, trailers);
  await page.evaluate(() => { sset('gc_offname_kofi@martinbrower.com','Kobe Mensah'); });
  await page.evaluate((s) => { go('yard'); ycOpenSlot(s); }, slot);
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
  return slot;
}
/* fill one trailer's card */
async function fill(page, i, v) {
  await page.locator('#ycgridwrap .ycgtile').nth(i).click();
  await expect(page.locator('#ycmodal')).toBeVisible();
  if (v.set)    await page.selectOption('#ycm_set', v.set);
  if (v.temp !== undefined) await page.fill('#ycm_temp', v.temp);
  if (v.fuel)   await page.selectOption('#ycm_fuel', v.fuel);
  if (v.intact) await page.selectOption('#ycm_intact', v.intact);
  if (v.door)   await page.selectOption('#ycm_door', v.door);
  await page.click('#ycm_save');
  await expect(page.locator('#ycmodal')).toBeHidden();
}
const OK = { set:'-10', temp:'-9.0', fuel:'3/4', intact:'Y', door:'20' };

/* ---- the tabs ---- */

test('the officer gets a tab per released trailer, not a spreadsheet', async ({ page }) => {
  await asOfficer(page);
  const slot = await openGrid(page);
  expect(await page.evaluate(() => location.hash)).toBe('#ycgrid/' + slot);
  await expect(page.locator('#sec-yardsheet')).toBeHidden();

  const tiles = page.locator('#ycgridwrap .ycgtile:not(.add)');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(0)).toContainText('57775');
  await expect(tiles.nth(0)).toContainText('FE');
  await expect(tiles.nth(1)).toContainText('LR7502');
  await expect(tiles.nth(1)).toContainText('FRIES');
  await expect(tiles.nth(0)).toHaveAttribute('aria-label', /To do/);
  // and a way to add one that was never released
  await expect(page.locator('#ycgridwrap .ycgtile.add')).toBeVisible();
});

test('a trailer the office never released can still be added', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile.add').click();
  await expect(page.locator('#ycmodal')).toBeVisible();
  await page.fill('#ycm_trailer', 'H30480');
  await page.fill('#ycm_product', 'FRIES');
  await page.selectOption('#ycm_set', '-10');
  await page.fill('#ycm_temp', '-8.0');
  await page.selectOption('#ycm_fuel', 'FULL');
  await page.selectOption('#ycm_intact', 'Y');
  await page.selectOption('#ycm_door', 'N/A');
  await page.click('#ycm_save');
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(4);
  await expect(page.locator('#ycgridwrap .ycgtile').nth(3)).toContainText('H30480');
});

/* ---- the card ---- */

test('the card offers the choices the yard actually uses', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();

  const opts = (id) => page.locator(id + ' option').allInnerTexts();
  // the set point only has to say which rule applies
  expect(await opts('#ycm_set')).toEqual(['', '-10', '34', 'DEF', 'OFF', 'Other…']);
  expect(await opts('#ycm_fuel')).toEqual(['', 'FULL', '3/4', '1/2', '1/4', 'EMPTY']);
  expect(await opts('#ycm_intact')).toEqual(['', 'Y', 'N']);

  const doors = await opts('#ycm_door');
  expect(doors[0]).toBe('');
  expect(doors[1]).toBe('N/A');            // sitting in the yard, on no door
  expect(doors[2]).toBe('2');
  expect(doors[doors.length - 1]).toBe('46');
  expect(doors.length).toBe(2 + 23);       // blank + N/A + 2..46 even
  for (const d of doors.slice(2)) expect(Number(d) % 2).toBe(0);
});

test('a set point that is neither the freezer nor the cooler can be typed', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await page.selectOption('#ycm_set', 'Other…');
  await expect(page.locator('#ycm_setother')).toBeVisible();
  await page.fill('#ycm_setother', '28.0');
  expect(await page.evaluate(() => YC.rows[0].set)).toBe('28.0');
});

test('escalate is worked out, never typed', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  // no input in the escalate box until there is something to escalate
  await expect(page.locator('#ycm_esc input')).toHaveCount(0);

  await page.selectOption('#ycm_set', '-10');
  await page.fill('#ycm_temp', '-9.0');
  await page.selectOption('#ycm_fuel', '3/4');
  await page.selectOption('#ycm_intact', 'Y');
  await page.selectOption('#ycm_door', '20');
  await expect(page.locator('#ycm_escbox')).toHaveText('N/A');

  // an empty tank is an escalation, and the reason is written for the officer
  await page.selectOption('#ycm_fuel', 'EMPTY');
  await expect(page.locator('#ycm_escbox')).toHaveText('Escalate');
});

test('the temperature rules on the poster are the ones enforced', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  const check = async (set, temp) => {
    await page.locator('#ycgridwrap .ycgtile').nth(0).click();
    await page.selectOption('#ycm_set', set);
    await page.fill('#ycm_temp', temp);
    await page.selectOption('#ycm_fuel', 'FULL');
    await page.selectOption('#ycm_intact', 'Y');
    await page.selectOption('#ycm_door', '20');
    const txt = await page.locator('#ycm_escbox').innerText();
    await page.click('#ycm_save');
    return txt;
  };
  expect(await check('-10', '0.0')).toBe('N/A');         // frozen, at the limit
  expect(await check('-10', '0.1')).toBe('Escalate');    // 0.1 and above is out
  expect(await check('34', '34.0')).toBe('N/A');         // refrigerated, at the limit
  expect(await check('34', '33.9')).toBe('Escalate');
  expect(await check('34', '40.0')).toBe('N/A');
  expect(await check('34', '40.1')).toBe('Escalate');
  expect(await check('DEF', '-9.0')).toBe('Escalate');   // defrost showing
});

test('a unit that is off is judged on being off, and on nothing else', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await page.selectOption('#ycm_set', 'OFF');
  // there is nothing else to fill in: the boxes below say so
  await expect(page.locator('#ycm_escbox')).toHaveText('Escalate');
  expect(await page.evaluate(() => ycEval(YC.rows[0])),
    'not also measured against a band it is not in').toEqual(['UNIT OFF']);
});

test('a temperature must be to the tenth before the card will close', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await page.selectOption('#ycm_set', '-10');
  await page.fill('#ycm_temp', '-9');            // no tenth
  await page.click('#ycm_save');
  await expect(page.locator('#ycmodal')).toBeVisible();          // held open
  await expect(page.locator('#toast')).toContainText('tenth');
  await page.fill('#ycm_temp', '-9.0');
  await page.click('#ycm_save');
  await expect(page.locator('#ycmodal')).toBeHidden();
});

/* ---- progress ---- */

test('a checked trailer is marked on its tab', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await fill(page, 0, OK);
  const tiles = page.locator('#ycgridwrap .ycgtile');
  await expect(tiles.nth(0)).toHaveClass(/done/);
  await expect(tiles.nth(0)).toHaveAttribute('aria-label', /Checked/);
  await expect(tiles.nth(0).locator('.ycgmark')).toHaveText('✓');
  await expect(tiles.nth(1)).not.toHaveClass(/done/);
  await expect(page.locator('#ycg_count')).toContainText('1 of 3 checked');
});

test('a trailer that escalates is marked differently from one that is fine', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await fill(page, 0, OK);
  await fill(page, 1, Object.assign({}, OK, { fuel:'1/4' }));
  const tiles = page.locator('#ycgridwrap .ycgtile');
  await expect(tiles.nth(0)).toHaveClass(/done/);
  await expect(tiles.nth(1)).toHaveClass(/esc/);
  await expect(tiles.nth(1)).toHaveAttribute('aria-label', /Escalate/);
  await expect(tiles.nth(1).locator('.ycgmark')).toHaveText('⚠');
  await expect(page.locator('#ycg_count')).toContainText('1 to escalate');
});

test('review only appears once every trailer is checked', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await expect(page.locator('#ycg_actions')).toBeHidden();
  await fill(page, 0, OK);
  await fill(page, 1, OK);
  await expect(page.locator('#ycg_actions')).toBeHidden();      // one still to do
  await fill(page, 2, OK);
  await expect(page.locator('#ycg_actions')).toBeVisible();
  await expect(page.locator('#ycg_review')).toContainText('Review and submit');
});

test('review opens the whole sheet to read before it is sent', async ({ page }) => {
  await asOfficer(page);
  const slot = await openGrid(page);
  await fill(page, 0, OK);
  await fill(page, 1, OK);
  await fill(page, 2, OK);
  await page.click('#ycg_review');
  await expect(page.locator('#sec-yardsheet')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#yardsheet/' + slot);
  const vals = await page.locator('#ycrows input').evaluateAll(
    els => els.map(e => e.value).filter(Boolean));
  expect(vals).toContain('57775');
  expect(vals).toContain('LR7502');
});

test('work survives a refresh part way through', async ({ page }) => {
  await asOfficer(page);
  const slot = await openGrid(page);
  await fill(page, 0, OK);
  await page.reload();
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#ycgrid/' + slot);
  await expect(page.locator('#ycg_count')).toContainText('1 of 3 checked');
  await expect(page.locator('#ycgridwrap .ycgtile').nth(0)).toHaveClass(/done/);
});

/* ---- what the receiving office sees ---- */

test('a released slot the officer has not finished reads as awaiting', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => {
    /* a slot whose calendar date is today, whatever hour the tests run at:
       after midnight the evening shift's 22:00 belongs to yesterday */
    const slot = ycShiftSlots().filter(s => ycSlotDate(s) === ycTodayISO())[0];
    const date = ycTodayISO();
    DB.yardslots = [{ id:date+'_'+slot, date, slot, loadedAt:new Date().toISOString(),
                      count:3, trailers:[{trailer:'57775',product:'FE'}] }];
    DB.yardchecks = [];
    ycSlotsPersist(); go('block');
  });
  const tile = page.locator('#bkboard .slot').filter({ hasText: 'Released' }).first();
  await expect(tile).toBeVisible();
  await expect(tile).toContainText('trailer');
});

test('a completed check opens for the office, on the slot they loaded', async ({ page }) => {
  await asOffice(page);
  const slot = await page.evaluate(() => {
    /* a slot whose calendar date is today, whatever hour the tests run at:
       after midnight the evening shift's 22:00 belongs to yesterday */
    const slot = ycShiftSlots().filter(s => ycSlotDate(s) === ycTodayISO())[0];
    const date = ycTodayISO();
    DB.yardslots = [{ id:date+'_'+slot, date, slot, loadedAt:new Date().toISOString(),
                      count:2, trailers:[{trailer:'57775',product:'FE'}] }];
    DB.yardchecks = [{ date, time:slot, name:'Kobe Mensah', ts:new Date().toISOString(), rows:[
      { trailer:'57775', product:'FE', set:'-10', temp:'-9.0', fuel:'1/4',
        intact:'Y', door:'24', action:'Reported to DC', escalate:['LOW FUEL: ¼ tank or less'] },
      { trailer:'LR7502', product:'FRIES', set:'-10.0', temp:'-2.1', fuel:'3/4',
        intact:'Y', door:'20', action:'', escalate:[] },
    ]}];
    ycSlotsPersist(); ycPersistAll(); go('block');
    return slot;
  });
  // this fixture has an escalation on it: the tile stays on the green of a
  // finished check and the band under it carries the count
  const tile = page.locator('#bkboard .slot.esc').first();
  await expect(tile).toBeVisible();
  await tile.click();
  const view = page.locator('#bkview');
  await expect(view).toBeVisible();
  await expect(page.locator('#bkview_title')).toContainText('yard check');
  // the office reads the sheet that was filed, drawn as it was emailed
  await expect(view.locator('.ycpaper img')).toBeVisible();
  await expect(view).toContainText('Kobe Mensah');
  await expect(view).toContainText('1 escalation');
  // and what was on it is still on the record behind it
  expect(await page.evaluate(() => DB.yardchecks[0].rows[0].escalate[0]))
    .toContain('LOW FUEL');
  expect(await page.evaluate(() => DB.yardchecks[0].rows[0].action)).toBe('Reported to DC');
  expect(await page.evaluate(() => location.hash)).toBe('#block/' + slot);

  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
});

test('the office cannot edit the check it is reading', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => {
    /* a slot whose calendar date is today, whatever hour the tests run at:
       after midnight the evening shift's 22:00 belongs to yesterday */
    const slot = ycShiftSlots().filter(s => ycSlotDate(s) === ycTodayISO())[0];
    const date = ycTodayISO();
    DB.yardslots = [{ id:date+'_'+slot, date, slot, loadedAt:new Date().toISOString(),
                      count:1, trailers:[{trailer:'57775',product:'FE'}] }];
    DB.yardchecks = [{ date, time:slot, name:'Kobe', ts:new Date().toISOString(),
      rows:[{ trailer:'57775', product:'FE', set:'-10.0', temp:'-9.0', fuel:'FULL',
              intact:'Y', door:'24', action:'', escalate:[] }] }];
    ycSlotsPersist(); ycPersistAll(); go('block');
  });
  await page.locator('#bkboard .slot').filter({ hasText:'Completed' }).first().click();
  await expect(page.locator('#bkview input, #bkview select')).toHaveCount(0);
});

/* ---- where an escalation goes ---- */

test('out of hours an escalation goes to the walkie, not the office', async ({ page }) => {
  await asOfficer(page);
  // 22 Aug 2026 is a Saturday
  const at = (day, h) => page.evaluate(({day, h}) =>
    ycEscalateTo(new Date(2026, 7, 22 + day, h, 0, 0)), {day, h});

  expect(await at(0, 10)).toContain('DC');            // Saturday morning: office open
  expect(await at(0, 15)).toContain('walkie');        // Saturday 15:00: closed
  expect(await at(1, 3)).toContain('walkie');         // Sunday 03:00
  expect(await at(1, 15)).toContain('walkie');        // Sunday 15:00
  expect(await at(2, 3)).toContain('walkie');         // Monday 03:00
  expect(await at(2, 9)).toContain('DC');             // Monday morning: open again
  expect(await at(4, 2)).toContain('walkie');         // any night, 00:00-05:00
  expect(await at(4, 9)).toContain('DC');
});

test('the escalation is on the record even when it was called in', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await fill(page, 0, Object.assign({}, OK, { fuel:'1/4' }));
  const row = await page.evaluate(() => ycData().rows[0]);
  expect(row.escalate).toContain('LOW FUEL: ¼ tank or less');
  expect(row.escTo, 'the record must say who it was raised with').toBeTruthy();
  // and a trailer with nothing wrong carries no route
  await fill(page, 1, OK);
  expect(await page.evaluate(() => ycData().rows[1].escTo)).toBe('');
});

test('clicking a ready check on the board opens the tabs, not the sheet', async ({ page }) => {
  await asOfficer(page);
  const slot = await released(page);
  await page.evaluate(() => { DB.yardchecks = []; ycPersistAll(); go('yard'); });
  const idx = await page.evaluate((s) => ycShiftSlots().indexOf(s), slot);
  await page.locator('#ycslots .slot').nth(idx).click();
  await expect(page.locator('#sec-ycgrid')).toBeVisible();
  await expect(page.locator('#sec-yardsheet')).toBeHidden();
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(3);
  // and one tap opens the card, not a grid of inputs
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await expect(page.locator('#ycmodal')).toBeVisible();
  await expect(page.locator('#ycm_title')).toContainText('57775');
});

/* One line on a wide card; on a narrower one the boxes wrap by design, and
   what matters then is that every box is still a real touch target and the
   card does not scroll sideways. */
async function expectCardRows(page) {
  const m = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#ycm_body .ycmbox')];
    const card = document.querySelector('.ycmcard');
    return {
      lines: new Set(boxes.map(e => Math.round(e.getBoundingClientRect().top))).size,
      narrowest: Math.min(...boxes.map(e => e.getBoundingClientRect().width)),
      cardWidth: Math.round(card.getBoundingClientRect().width),
      sideways: card.scrollWidth > card.clientWidth + 1,
    };
  });
  if (m.cardWidth > 820) expect(m.lines, 'a wide card is one row, as drawn').toBe(1);
  else expect(m.lines, 'a narrow card wraps, it does not shrink away').toBeGreaterThan(1);
  expect(m.narrowest, 'no box may shrink below a thumb').toBeGreaterThan(110);
  expect(m.sideways, 'the card must never scroll sideways').toBe(false);
}

test('the card is one row of boxes and a Save, nothing more', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();

  const labels = await page.locator('#ycm_body .ycmbox > span').allInnerTexts();
  expect(labels).toEqual(['TEMP SET POINT','TEMP','FUEL','INTACT (Y/N)','DOOR #','ESCALATE']);

  // All six sit on one line where the card has the room, which is how it was
  // drawn. Below 820px they wrap on purpose rather than shrink to nothing.
  await expectCardRows(page);

  // and nothing hangs below the row but the button
  await expect(page.locator('#ycmodal .ycmfoot button')).toHaveCount(1);
  await expect(page.locator('#ycm_esc')).toHaveCount(0);
});

test('an escalation stays inside its own box', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await fill(page, 0, Object.assign({}, OK, { fuel:'EMPTY' }));
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await expect(page.locator('#ycm_escbox')).toHaveText('Escalate');
  // the box keeps the shape of every other box on the card
  expect(await page.locator('#ycm_escbox input').count()).toBe(0);
  await expectCardRows(page);
});

test('a unit that is switched off is an escalation on its own', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await page.selectOption('#ycm_set', 'OFF');
  // the rest of the row is dashes; there is nothing left to fill in
  await expect(page.locator('#ycm_escbox')).toHaveText('Escalate');
  await page.click('#ycm_save');
  await expect(page.locator('#ycgridwrap .ycgtile').nth(0)).toHaveClass(/esc/);
  const row = await page.evaluate(() => ycData().rows[0]);
  expect(row.escalate).toContain('UNIT OFF');
});

/* ---- the trailers page reads like the streaming page it was drawn from ---- */

test('a trailer number with a space is not mistaken for a product', async ({ page }) => {
  await asOfficer(page);
  expect(await page.evaluate(() => blockParse(
    'LR 7540\nLR7541 FRIES\nH20045, CHICKEN SD\n2022\nR25106\tBUNS'
  ))).toEqual([
    { trailer:'LR7540',  product:'' },          // a space inside the number
    { trailer:'LR7541',  product:'FRIES' },     // number then product
    { trailer:'H20045',  product:'CHICKEN SD' },// comma
    { trailer:'2022',    product:'' },          // a number is a trailer, not a product
    { trailer:'R25106',  product:'BUNS' },      // tab
  ]);
});

test('the officer can search the trailers on the check', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page, [
    { trailer:'LR7540', product:'FRIES' },
    { trailer:'H20045', product:'CHICKEN SD' },
    { trailer:'LR2325', product:'BUNS' },
  ]);
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(3);

  await page.fill('#ycg_q', 'LR');
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(2);
  await page.fill('#ycg_q', 'h200');               // by number, and case does not matter
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(1);
  await expect(page.locator('#ycgridwrap .ycgtile').first()).toContainText('H20045');

  // a filtered tile still opens its own trailer
  await page.locator('#ycgridwrap .ycgtile').first().click();
  await expect(page.locator('#ycm_title')).toContainText('H20045');
  await page.click('.ycmx');

  await page.fill('#ycg_q', 'ZZZ');
  await expect(page.locator('#ycgridwrap .ycgnone')).toBeVisible();
  await page.fill('#ycg_q', '');
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(3);
});

test('a long list is cut short until See more is tapped', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page, Array.from({length:14}, (_, i) =>
    ({ trailer:'LR' + (7500+i), product:'FRIES' })));
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(8);
  const more = page.locator('#ycg_more');
  await expect(more).toBeVisible();
  await expect(more).toHaveText('See more (6)');
  await more.click();
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(14);
  await expect(more).toBeHidden();
});

test('the rows are headed Trailers', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await expect(page.locator('#sec-ycgrid .ycgh')).toHaveText('Trailers');
});

test('an added trailer left blank never becomes a tile', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  await page.locator('#ycgridwrap .ycgtile.add').click();
  await expect(page.locator('#ycmodal')).toBeVisible();
  await page.click('.ycmx');                       // opened, nothing typed, closed
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(3);
  await expect(page.locator('#ycgridwrap')).not.toContainText('No product');
});

test('the officer can remove a trailer they added, but not one the office sent',
  async ({ page }) => {
  await asOfficer(page);
  await openGrid(page);
  // one from the office: no way to remove it
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await expect(page.locator('.ycmdel')).toHaveCount(0);
  await page.click('.ycmx');

  // one the officer added: removable
  await page.locator('#ycgridwrap .ycgtile.add').click();
  await page.fill('#ycm_trailer', 'H30480');
  await page.click('#ycm_save');
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(4);

  await page.locator('#ycgridwrap .ycgtile').nth(3).click();
  await expect(page.locator('.ycmdel')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.click('.ycmdel');
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(3);
});

test('a trailer number split on its space is mended on an old list', async ({ page }) => {
  await asOfficer(page);
  await openGrid(page, [{ trailer:'LR', product:'7540' }, { trailer:'H20045', product:'FRIES' }]);
  const tiles = page.locator('#ycgridwrap .ycgtile:not(.add)');
  await expect(tiles.nth(0)).toContainText('LR7540');
  await expect(tiles.nth(0)).toContainText('No product');
});

test('each check keeps its own trailers, and does not lend them to another',
  async ({ page }) => {
  await asOfficer(page);
  const slots = await page.evaluate(() => {
    const s = ycShiftSlots();
    const date = ycSlotDate(s[2]);
    DB.yardslots = [{ id:date+'_'+s[2], date, slot:s[2], loadedAt:new Date().toISOString(),
      count:2, trailers:[{trailer:'AAA111',product:'FRIES'},{trailer:'BBB222',product:'BUNS'}] }];
    ycSlotsPersist(); DB.yardchecks = []; ycPersistAll();
    go('yard');
    return { a: s[2], b: s[3] };
  });

  // work the released check
  await page.evaluate((s) => ycOpenSlot(s), slots.a);
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(2);
  await fill(page, 0, OK);
  await expect(page.locator('#ycg_count')).toContainText('1 of 2 checked');

  // a different check, with nothing released, starts empty
  await page.evaluate((s) => ycOpenSlot(s), slots.b);
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(0);
  await expect(page.locator('#ycgridwrap')).not.toContainText('AAA111');

  // and the first check still has its own work
  await page.evaluate((s) => ycOpenSlot(s), slots.a);
  await expect(page.locator('#ycgridwrap .ycgtile:not(.add)')).toHaveCount(2);
  await expect(page.locator('#ycg_count')).toContainText('1 of 2 checked');
  await expect(page.locator('#ycgridwrap .ycgtile').nth(0)).toHaveClass(/done/);
});
