/* The filed check is a picture of a sheet taller than any screen. Asserting
   that the picture is "visible" passes for a picture that is clipped to its
   top edge and cannot be moved - which is how every check came to look like
   every other check on the office's iPad. These check what a person can
   actually see and do. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const ROW = (trailer, product) => ({
  trailer, product, set:'-10', temp:'-9.1', fuel:'FULL', intact:'Y', door:'20', escalate:[],
});

async function openCheck(page, slot, who, trailer) {
  await page.evaluate(({ slot, who, trailer }) => {
    const d = ycTodayISO();
    DB.yardchecks = [{ date:d, time:slot, name:who, ts:new Date().toISOString(),
                       rows:[{ trailer, product:'FRIES', set:'-10', temp:'-9.1',
                               fuel:'FULL', intact:'Y', door:'20', escalate:[] }] }];
    ycPersistAll();
    if (typeof blockViewClose === 'function') blockViewClose();
    go('block', false, slot);
  }, { slot, who, trailer });
  await expect(page.locator('#bkview_body .ycpaper img')).toBeVisible();
}

const asOffice = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });

test('the whole sheet can be reached, not just the top of it', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await asOffice(page);
  await openCheck(page, '1000', 'Bob', 'BBB222');
  const m = await page.evaluate(() => {
    const w = document.querySelector('#bkview_body .ycpaper');
    const before = w.scrollTop;
    w.scrollTop = w.scrollHeight;
    return { taller: w.scrollHeight > w.clientHeight + 1,
             moved: w.scrollTop > before,
             atBottom: Math.abs(w.scrollTop + w.clientHeight - w.scrollHeight) < 3 };
  });
  expect(m.taller, 'the sheet is taller than the window, as paper is').toBe(true);
  expect(m.moved, 'and the box it sits in must move').toBe(true);
  expect(m.atBottom, 'all the way to the last row').toBe(true);
});

test('nothing in the overlay is clipped away with no way to get at it', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await asOffice(page);
  await openCheck(page, '1000', 'Bob', 'BBB222');
  const stuck = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#bkview *').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY === 'hidden')
        out.push((el.className || el.id) + ' ' + el.scrollHeight + '/' + el.clientHeight);
    });
    return out;
  });
  expect(stuck, 'content taller than its box, with the box refusing to scroll').toEqual([]);
});

test('two different checks are two different sheets', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await asOffice(page);
  await openCheck(page, '0800', 'Alice', 'AAA111');
  const first = await page.locator('#bkview_body .ycpaper img').getAttribute('src');
  await openCheck(page, '1000', 'Bob', 'BBB222');
  const second = await page.locator('#bkview_body .ycpaper img').getAttribute('src');
  expect(second, 'the office was shown the same drawing every time').not.toBe(first);
  await expect(page.locator('#bkview_body .bkvmeta')).toContainText('Bob');
});

test('the sheet on screen is the check that was asked for', async ({ page }) => {
  await asOffice(page);
  await openCheck(page, '0800', 'Alice', 'AAA111');
  await expect(page.locator('#bkview_body .bkvmeta')).toContainText('Alice');
  await expect(page.locator('#bkview_title')).toContainText('08');
  await openCheck(page, '1000', 'Bob', 'BBB222');
  await expect(page.locator('#bkview_body .bkvmeta')).toContainText('Bob');
  await expect(page.locator('#bkview_title')).toContainText('10');
});

test('the overlay follows the theme; only the paper is white', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await asOffice(page);
  await openCheck(page, '1000', 'Bob', 'BBB222');
  const m = await page.evaluate(() => {
    const lum = (c) => { const n = c.match(/\d+/g).map(Number);
      return (0.2126*n[0] + 0.7152*n[1] + 0.0722*n[2]) / 255; };
    return {
      body: lum(getComputedStyle(document.getElementById('bkview_body')).backgroundColor),
      bar: lum(getComputedStyle(document.querySelector('#bkview .dvbar')).backgroundColor),
    };
  });
  expect(m.body, 'the room around the sheet must not be a lamp').toBeLessThan(0.4);
  expect(m.bar).toBeLessThan(0.4);
});

test('the sheet is still readable width, not stretched across a desk', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await asOffice(page);
  await openCheck(page, '1000', 'Bob', 'BBB222');
  const w = await page.evaluate(() =>
    Math.round(document.querySelector('#bkview_body .ycpaper img').getBoundingClientRect().width));
  expect(w).toBeLessThanOrEqual(900);
  expect(w).toBeGreaterThan(400);
});

test('and fills the width of an iPad, where the room is tighter', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await asOffice(page);
  await openCheck(page, '1000', 'Bob', 'BBB222');
  const m = await page.evaluate(() => {
    const img = document.querySelector('#bkview_body .ycpaper img').getBoundingClientRect();
    return { w: Math.round(img.width), vw: innerWidth };
  });
  expect(m.w).toBeGreaterThan(m.vw - 60);
});

/* ---- a key that explains colours has to be in those colours ---- */
const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });

const swatches = (page, sel) => page.evaluate((s) =>
  [...document.querySelectorAll(s + ' .lg')].map(l => ({
    label: l.textContent.trim(),
    /* body over band: the swatch is a two-stop gradient now, because two
       states can share a fill and differ only in the bar underneath, so the
       thing that identifies a swatch is the whole image, not one colour */
    colour: getComputedStyle(l.querySelector('i')).backgroundImage,
  })), sel);

test('every colour in the officer’s key is its own colour', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => go('yard'));
  const sw = await swatches(page, '#yclegend');
  expect(sw.length).toBeGreaterThan(4);
  expect(new Set(sw.map(x => x.colour)).size, 'two keys looking identical explain nothing')
    .toBe(sw.length);
  for (const x of sw) expect(x.colour, `${x.label} swatch must be painted`).not.toBe('none');
});

test('and every colour in the office’s key, which was all grey', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.evaluate(() => { go('block'); blockRender(); });
  const sw = await swatches(page, '#bk_key');
  expect(sw.length).toBeGreaterThan(3);
  expect(new Set(sw.map(x => x.colour)).size, 'the key took its colour from --c, which '
    + 'only the tiles carried, so every swatch fell back to the same grey').toBe(sw.length);
});

test('a key swatch matches the tile it stands for', async ({ page }) => {
  await asOfficer(page);
  await page.evaluate(() => {
    DB.yardslots = [{ date: ycSlotDate(ycShiftSlots()[1]), slot: ycShiftSlots()[1],
                      loadedAt: new Date().toISOString(), count: 3 }];
    ycSlotsPersist(); go('yard'); renderYardSlots();
  });
  const m = await page.evaluate(() => {
    const tile = document.querySelector('#ycslots .slot.ready');
    const key = document.querySelector('#yclegend .lg.ready i');
    if (!tile || !key) return null;
    return { tile: getComputedStyle(tile).getPropertyValue('--c').trim(),
             key: getComputedStyle(key).getPropertyValue('--c').trim() };
  });
  if (m) expect(m.key, 'one source, so they cannot drift apart').toBe(m.tile);
});
