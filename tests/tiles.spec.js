/* One square, one size, both apps. The receiving office's tiles were capped
   by a formula of their own and came out noticeably smaller than the
   officer's, and the gate queue wore a different truck. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');
const fs = require('fs');

const box = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return { w: Math.round(b.width), h: Math.round(b.height) };
};

async function tiles(page, role) {
  await H.gotoApp(page, { user:{email: role==='office' ? 'o@m.com' : 'k@m.com'}, role });
  await page.evaluate((r) => go(r === 'office' ? 'office' : 'home'), role);
  await page.waitForTimeout(250);
  return box(page, role === 'office' ? '#sec-office .tile' : '#sec-home .tile');
}

test('the office tile is the officer tile, to the pixel', async ({ page }, info) => {
  const off = await tiles(page, 'officer');
  const bureau = await tiles(page, 'office');
  console.log(info.project.name, 'officer', JSON.stringify(off), 'office', JSON.stringify(bureau));
  expect(Math.abs(bureau.w - off.w), 'tile widths differ').toBeLessThanOrEqual(2);
  expect(Math.abs(bureau.h - off.h), 'tile heights differ').toBeLessThanOrEqual(2);
});

test('a tile is square in both', async ({ page }) => {
  for (const r of ['officer', 'office']) {
    const t = await tiles(page, r);
    expect(Math.abs(t.w - t.h), r + ' tile is not square').toBeLessThanOrEqual(2);
  }
});

test('the four office tiles stay on one line on a wide screen',
  async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'a phone stacks them two by two');
  await tiles(page, 'office');
  const tops = await page.$$eval('#sec-office .tile',
    els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, 'they wrapped').toBe(1);
});

test('nothing overflows the window', async ({ page }) => {
  for (const r of ['officer', 'office']) {
    await tiles(page, r);
    const over = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth > window.innerWidth + 1,
      y: document.documentElement.scrollHeight > window.innerHeight + 1 }));
    expect(over.x, r + ' scrolls sideways').toBe(false);
    expect(over.y, r + ' does not fit the window').toBe(false);
  }
});

test('the gate queue wears the same truck as the yard check', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'k@m.com'}, role:'officer' });
  const yard = await page.textContent("#sec-home button[onclick=\"go('yard')\"] .tico");
  const queue = await page.textContent("#sec-office button[onclick=\"go('queue')\"] .tico");
  expect(queue.trim()).toBe(yard.trim());
});

test('and the schedule tile is the same on both sides', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'k@m.com'}, role:'officer' });
  const a = await page.textContent("#sec-home button[onclick=\"go('sched')\"] .tico");
  const b = await page.textContent("#sec-office button[onclick=\"go('sched')\"] .tico");
  expect(b.trim()).toBe(a.trim());
});

/* the line under the tiles is on both screens, and read side by side */
test('the stat line counts and separates the same way in both', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'k@m.com'}, role:'officer' });
  await page.evaluate(() => {
    DB.orders = [{date:isoToday(), order:'1', zone:'D', vendor:'V', cases:1, pallets:1}];
    persist(); stat(); if (typeof officeStat === 'function') officeStat();
  });
  const a = await page.textContent('#datastat');
  const b = await page.textContent('#officestat');
  expect(a, 'one order is not "1 orders"').toContain('1 order loaded');
  expect(b).toContain('1 order loaded');
  expect(a).not.toContain('•');       // the same separator on both
  expect(b).not.toContain('•');
  expect(a).toContain('·');
  expect(b).toContain('·');

  await page.evaluate(() => {
    DB.orders = [1,2].map(i => ({date:isoToday(), order:''+i, zone:'D', vendor:'V', cases:1, pallets:1}));
    persist(); stat(); if (typeof officeStat === 'function') officeStat();
  });
  expect(await page.textContent('#datastat')).toContain('2 orders loaded');
  expect(await page.textContent('#officestat')).toContain('2 orders loaded');
});
