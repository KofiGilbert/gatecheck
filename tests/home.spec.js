const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function signedIn(page) {
  await H.gotoApp(page, { user: { email: 'kofi@martinbrower.com' } });
  await expect(page.locator('#login')).toBeHidden();
}

test('the app opens on a menu of six tiles', async ({ page }) => {
  await signedIn(page);
  await expect(page.locator('#sec-home')).toBeVisible();
  const tiles = page.locator('#sec-home .tile');
  await expect(tiles).toHaveCount(6);
  for (const label of ['Search','Schedule','Seal Form','Yard','Log','Saved'])
    await expect(page.locator('#sec-home .tile', { hasText: label })).toHaveCount(1);
  await expect(page.locator('nav')).toHaveCount(0);          // the old tab bar is gone
  await expect(page.locator('#hdrtitle')).toBeEmpty();       // no wordmark in the bar
  await expect(page.locator('#menubtn')).toBeVisible();
});

test('the screen title is centred in the bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*="yard"]');
  await expect(page.locator('#hdrtitle')).toHaveText('Yard Check');
  const m = await page.evaluate(() => {
    const t = document.getElementById('hdrtitle').getBoundingClientRect();
    return { centre: t.left + t.width / 2, half: innerWidth / 2 };
  });
  expect(Math.abs(m.centre - m.half), 'title is not centred in the bar').toBeLessThanOrEqual(2);
});

test('menu sits hard left, profile hard right', async ({ page }) => {
  for (const v of [{width:390,height:844},{width:1440,height:900}]) {
    await page.setViewportSize(v);
    await signedIn(page);
    const m = await page.evaluate(() => {
      const b = document.getElementById('menubtn').getBoundingClientRect();
      const p = document.querySelector('.hdrprof').getBoundingClientRect();
      return { menuLeft: b.left, profRight: innerWidth - p.right, w: innerWidth,
               menuRight: b.right, profLeft: p.left };
    });
    expect(m.menuLeft, `${v.width}: menu not at the left edge`).toBeLessThanOrEqual(20);
    expect(m.profRight, `${v.width}: profile not at the right edge`).toBeLessThanOrEqual(20);
    expect(m.profLeft, `${v.width}: profile must sit right of the menu`).toBeGreaterThan(m.menuRight);
  }
});

test('name and email are always visible beside the profile icon', async ({ page }) => {
  for (const v of [{width:390,height:844},{width:900,height:800},{width:1440,height:900}]) {
    await page.setViewportSize(v);
    await signedIn(page);
    await page.evaluate(() => { sset('gc_offname_kofi@martinbrower.com','Kobe'); menuFill(); });
    await expect(page.locator('#hdrname'), `${v.width}px name`).toBeVisible();
    await expect(page.locator('#hdrname')).toHaveText('Kobe');
    await expect(page.locator('#hdrmail'), `${v.width}px email`).toBeVisible();
    await expect(page.locator('#hdrmail')).toHaveText('kofi@martinbrower.com');
    await expect(page.locator('.hpavatar')).toBeVisible();
  }
});

test('only the menu icon opens the menu, not the profile', async ({ page }) => {
  await signedIn(page);
  // the profile is display-only: no button, no handler
  const prof = page.locator('.hdrprof');
  expect(await prof.evaluate(el => el.tagName)).not.toBe('BUTTON');
  expect(await prof.evaluate(el => !!el.getAttribute('onclick'))).toBe(false);
  await prof.click();
  await expect(page.locator('#drawer'), 'profile must not open the menu').toBeHidden();
  await page.click('#menubtn');
  await expect(page.locator('#drawer')).toBeVisible();
});

test('tiles are square', async ({ page }) => {
  for (const v of [{width:390,height:844},{width:820,height:1180},{width:1180,height:820}]) {
    await page.setViewportSize(v);
    await signedIn(page);
    for (let i = 0; i < 6; i++) {
      const b = await page.locator('#sec-home .tile').nth(i).boundingBox();
      const ratio = b.width / b.height;
      expect(ratio, `${v.width}x${v.height} tile ${i} is ${b.width.toFixed(0)}x${b.height.toFixed(0)}`)
        .toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    }
  }
});

test('the menu slides in under a MENU heading', async ({ page }) => {
  await signedIn(page);
  await expect(page.locator('#drawer')).toBeHidden();
  await page.click('#menubtn');
  const d = page.locator('#drawer');
  await expect(d).toBeVisible();
  await expect(page.locator('.drawerpanel')).toHaveAttribute('aria-modal', 'true');
  // the panel is headed "Menu"; the officer identity lives in the header bar
  await expect(page.locator('.dhead')).toHaveText('Menu');
  await expect(page.locator('#drawer .davatar')).toHaveCount(0);
  await expect(page.locator('#drawer')).not.toContainText('kofi@martinbrower.com');
  for (const label of ['Home','Gate log','Yard check','Saved forms','Settings','Sign out'])
    await expect(page.locator('.ditem', { hasText: label })).toHaveCount(1);
  // every item is a comfortable target
  const n = await page.locator('.ditem').count();
  for (let i = 0; i < n; i++) {
    const b = await page.locator('.ditem').nth(i).boundingBox();
    expect(b.height, `menu item ${i}`).toBeGreaterThanOrEqual(44);
  }
});

test('the menu closes on backdrop, Escape, and on choosing an item', async ({ page }) => {
  await signedIn(page);
  await page.click('#menubtn');
  const w = page.viewportSize().width;
  await page.mouse.click(w - 10, 200);          // backdrop, clear of the panel
  await expect(page.locator('#drawer')).toBeHidden();

  await page.click('#menubtn');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).toBeHidden();

  await page.click('#menubtn');
  await page.click('.ditem:has-text("Settings")');
  await expect(page.locator('#drawer')).toBeHidden();
  await expect(page.locator('#sec-settings')).toBeVisible();
});

test('opening the menu moves focus into it and restores it on close', async ({ page }) => {
  await signedIn(page);
  await page.click('#menubtn');
  expect(await page.evaluate(() => document.activeElement.className)).toContain('ditem');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('menubtn');
});

test('the tiles fill the screen on a phone and an iPad', async ({ page }) => {
  const sizes = [
    { w: 390,  h: 844,  name: 'iPhone portrait' },
    { w: 820,  h: 1180, name: 'iPad portrait' },
    { w: 1180, h: 820,  name: 'iPad landscape' },
  ];
  for (const s of sizes) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await signedIn(page);
    const m = await page.evaluate(() => {
      const t = document.querySelector('#sec-home .tiles').getBoundingClientRect();
      const hdr = document.querySelector('header').getBoundingClientRect();
      return { top: t.top, bottom: t.bottom, hdr: hdr.height, vh: innerHeight };
    });
    const available = m.vh - m.hdr;
    const used = m.bottom - m.top;
    // tiles are square, so they fill whichever axis runs out first
    expect(used / available, `${s.name}: grid only uses ${(100*used/available).toFixed(0)}% of the height`)
      .toBeGreaterThan(0.6);
    expect(m.bottom, `${s.name}: tiles overflow the screen`).toBeLessThanOrEqual(m.vh + 2);
    const tile = await page.locator('#sec-home .tile').first().boundingBox();
    expect(tile.width, `${s.name}: tiles are too small`).toBeGreaterThanOrEqual(
      Math.min(s.w, s.h) * 0.22);
  }
});

test('all six tiles are visible without scrolling', async ({ page }) => {
  for (const s of [{width:390,height:844},{width:820,height:1180},{width:1180,height:820}]) {
    await page.setViewportSize(s);
    await signedIn(page);
    for (let i = 0; i < 6; i++)
      await expect(page.locator('#sec-home .tile').nth(i), `${s.width}x${s.height} tile ${i}`).toBeInViewport();
  }
});

test('a tile opens its screen, and the browser back returns to the menu', async ({ page }) => {
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*="yard"]');
  await expect(page.locator('#sec-yard')).toBeVisible();
  await expect(page.locator('#sec-home')).toBeHidden();
  await expect(page.locator('#hdrtitle')).toHaveText('Yard Check');
  // no arrow in the bar: the platform's own back gesture does this
  await expect(page.locator('#backbtn')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('#sec-home')).toBeVisible();
  await expect(page.locator('#hdrtitle')).toBeEmpty();
});

test('back walks the whole trail, not just one step', async ({ page }) => {
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*="yard"]');
  await expect(page.locator('#sec-yard')).toBeVisible();
  await page.goBack();
  await page.click('#sec-home .tile[onclick*="log"]');
  await expect(page.locator('#sec-log')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#sec-home')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#sec-log'), 'forward should work too').toBeVisible();
});

test('back closes an open menu before it navigates', async ({ page }) => {
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*="yard"]');
  await page.click('#menubtn');
  await expect(page.locator('#drawer')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#drawer')).toBeHidden();
});

test('every tile reaches a real screen', async ({ page }) => {
  await signedIn(page);
  const map = { search:'sec-search', sched:'sec-sched', form:'sec-form',
                yard:'sec-yard', log:'sec-log', hist:'sec-hist' };
  for (const [key, id] of Object.entries(map)) {
    await page.click(`.tile[onclick*="${key}"]`);
    await expect(page.locator('#' + id), `tile ${key}`).toBeVisible();
    await page.goBack();
  }
});

test('the section title is shown in full, or not at all', async ({ page }) => {
  for (const v of [{width:390,height:844},{width:820,height:1180},{width:1440,height:900}]) {
    await page.setViewportSize(v);
    await signedIn(page);
    await page.click('#sec-home .tile[onclick*="form"]');
    const t = page.locator('#hdrtitle');
    const st = await t.evaluate(el => ({
      shown: getComputedStyle(el).display !== 'none',
      clipped: el.scrollWidth > el.clientWidth + 1,
    }));
    if (st.shown) {
      await expect(t).toHaveText('Seal Form');
      expect(st.clipped, `${v.width}px: title is clipped`).toBe(false);
    }
    // whatever happens to the title, the identity must survive
    await expect(page.locator('#hdrname'), `${v.width}px name`).toBeVisible();
    await expect(page.locator('#hdrmail'), `${v.width}px email`).toBeVisible();
    await expect(page.locator('#menubtn')).toBeVisible();
  }
});

test('the schedule summary moved off the header onto the menu', async ({ page }) => {
  await signedIn(page);
  await expect(page.locator('#sec-home #datastat')).toBeVisible();
  await expect(page.locator('header #datastat')).toHaveCount(0);
});
