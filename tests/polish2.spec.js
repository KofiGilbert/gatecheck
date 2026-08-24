/* Four things the office and the officers found on the iPad. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const asOffice  = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'},  role:'officer' });

/* ---- 1. nothing in a slot tile may wrap or spill ---- */
test('no label in a block tile can wrap out of its card', async ({ page }) => {
  await asOffice(page);
  for (const size of ['normal', 'large', 'larger']) {
    for (const [w, h] of [[390, 844], [820, 1180], [1180, 820], [1440, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((s) => {
        PREFS.size = s; prefsSave();
        DB.yardslots = []; ycSlotsPersist(); go('block'); blockRender();
      }, size);
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('#bk_am .slot, #bk_pm .slot').forEach(t => {
          const r = t.getBoundingClientRect();
          t.querySelectorAll('.top, .kpi').forEach(el => {
            const b = el.getBoundingClientRect();
            if (el.scrollWidth > el.clientWidth + 1)
              out.push('clipped "' + el.textContent.trim() + '"');
            if (b.bottom > r.bottom + 1 || b.right > r.right + 1)
              out.push('spilled "' + el.textContent.trim() + '"');
          });
        });
        return [...new Set(out)];
      });
      expect(bad, `${size} at ${w}x${h}`).toEqual([]);
    }
  }
});

test('the tile that needs a list says so in two words', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => { DB.yardslots = []; ycSlotsPersist(); go('block'); blockRender(); });
  const due = page.locator('#bk_am .slot.due, #bk_pm .slot.due').first();
  if (await due.count()) {
    await expect(due).toContainText('Load this one');
    await expect(due.locator('.kpi')).toHaveText('Add list');
  }
});

/* ---- 2. an empty schedule is an empty state ---- */
test('with nothing loaded the card sits in the middle of the screen', async ({ page }) => {
  for (const [w, h] of [[390, 844], [820, 1180], [1180, 820]]) {
    await page.setViewportSize({ width: w, height: h });
    await asOfficer(page);
    await page.evaluate(() => go('sched'));
    const m = await page.evaluate(() => {
      const c = document.getElementById('loadcard').getBoundingClientRect();
      return { off: Math.abs(Math.round(c.top + c.height / 2) - Math.round(innerHeight / 2)),
               scrolls: document.documentElement.scrollHeight > innerHeight + 2 };
    });
    expect(m.off, `${w}x${h}: not centred`).toBeLessThanOrEqual(8);
    expect(m.scrolls, `${w}x${h}: should not scroll`).toBe(false);
  }
});

test('the copy is short, and does not say the same thing twice', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#loadttl')).toHaveText('No schedule yet');
  const hint = await page.locator('#loadhint').innerText();
  expect(hint.split(/\s+/).length, 'one short line').toBeLessThanOrEqual(12);
  // the old paragraph is gone
  expect(hint).not.toContain('rather than wait');
  expect(hint).not.toContain('whole team');
  // and the separate empty-state sentence is not repeated underneath
  await expect(page.locator('#schednone')).toBeHidden();
});

test('once a schedule is loaded the card goes back to the top', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await asOfficer(page);
  await page.evaluate(() => {
    DB.local = [{ date: isoToday(), order: '8040001', zone: 'D', cases: 9, pallets: 1 }];
    schedRebuild(); persist(); go('sched');
  });
  await expect(page.locator('#loadttl')).toHaveText('Load a schedule');
  const top = await page.evaluate(() =>
    Math.round(document.getElementById('loadcard').getBoundingClientRect().top));
  expect(top, 'near the top, with the schedule under it').toBeLessThan(160);
});

test('the office gets its own short line', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  const hint = await page.locator('#loadhint').innerText();
  expect(hint.split(/\s+/).length).toBeLessThanOrEqual(12);
  expect(hint).toContain('reaches the yard');
});

/* ---- 3. every screen offers every way in ---- */
async function menuCount(page) {
  await page.locator('#dzplus').click();
  const n = await page.evaluate(() =>
    [...document.querySelectorAll('#dzmenu button')].filter(b => b.offsetParent).length);
  await page.keyboard.press('Escape');
  return n;
}

test('an officer loading a schedule gets every option the office gets', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  expect(await menuCount(page)).toBe(5);
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  expect(await menuCount(page)).toBe(5);
});

test('a yard check and a trailer block get all five too', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
  });
  expect(await menuCount(page), 'the yard check').toBe(5);

  await asOffice(page);
  await page.evaluate(() => { go('block'); blockPick(YC_SHIFT_AM[1]); });
  expect(await menuCount(page), 'the trailer block').toBe(5);
});

test('a PDF of a trailer list is read, not turned away', async ({ page }) => {
  await asOffice(page);
  await page.evaluate(() => { go('block'); blockPick(YC_SHIFT_AM[1]); });
  const msg = await page.evaluate(async () => {
    let said = ''; const real = window.toast; window.toast = (m) => { said = m; };
    // the grid a PDF reader hands back
    ingGridLand([['LR7524', 'FRIES'], ['R25106', 'BUNS']], 'PDF');
    window.toast = real; return said;
  });
  expect(msg).not.toContain('comes as a photo');
  await expect(page.locator('#bk_list')).toHaveValue('LR7524, FRIES\nR25106, BUNS');
});

/* ---- 4. the loader is not welded to the tile grid ---- */
test('the trailer loader stands clear of the tiles below it', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    const slot = ycShiftSlots()[1];
    DB.yardslots = []; ycSlotsPersist(); YC = null; YC_VIEW = null;
    go('ycgrid', false, slot);
  });
  const gap = await page.evaluate(() =>
    Math.round(document.getElementById('ycgridwrap').getBoundingClientRect().top
             - document.getElementById('dzwrap').getBoundingClientRect().bottom));
  expect(gap, 'it was touching the Add trailer tile').toBeGreaterThanOrEqual(12);
});

test('and leaves no gap behind on the screens it is not on', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('sched'));
  const h = await page.evaluate(() => {
    const el = document.getElementById('dzhost_yard');
    return Math.round(el.getBoundingClientRect().height);
  });
  expect(h, 'an empty host must take no room').toBe(0);
});

/* ---- 5. three and three, whichever way the iPad is held ---- */
const SHAPES = [
  { name: 'iPad portrait',  w: 820,  h: 1180, perRow: 3 },
  { name: 'iPad landscape', w: 1180, h: 820,  perRow: 3 },
  { name: 'iPad Pro landscape', w: 1366, h: 1024, perRow: 3 },
  { name: 'phone portrait', w: 390,  h: 844,  perRow: 2 },
  { name: 'phone landscape', w: 844, h: 390,  perRow: 3 },
  { name: 'laptop',         w: 1440, h: 900,  perRow: 3 },
];

test('the yard board is three and three, not six thin strips', async ({ page }) => {
  await asOfficer(page);
  for (const s of SHAPES) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.evaluate(() => go('yard'));
    const m = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#ycslots .slot')];
      const rows = new Set(t.map(x => Math.round(x.getBoundingClientRect().top))).size;
      const r = t[0].getBoundingClientRect();
      return { perRow: t.length / rows, w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(m.perRow, s.name).toBe(s.perRow);
    expect(m.w, s.name + ': the cards must stay big enough to read and hit')
      .toBeGreaterThanOrEqual(150);
  }
});

test('the office board keeps its own shape: all twelve, six across', async ({ page }) => {
  await asOffice(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(() => { go('block'); blockRender(); });
  const m = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#bk_am .slot')];
    return { perRow: t.length / new Set(t.map(x => Math.round(x.getBoundingClientRect().top))).size,
             shifts: document.querySelectorAll('.bkslots').length };
  });
  // the office is answering "how does the day look", not "what is my next check"
  expect(m.perRow, 'six across, as it always was').toBe(6);
  expect(m.shifts, 'both shifts on screen').toBe(2);
});

test('a genuinely wide desktop still gets the single row', async ({ page }) => {
  await asOfficer(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => go('yard'));
  const perRow = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#ycslots .slot')];
    return t.length / new Set(t.map(x => Math.round(x.getBoundingClientRect().top))).size;
  });
  expect(perRow).toBe(6);
});
