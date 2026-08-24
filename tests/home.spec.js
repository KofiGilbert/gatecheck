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
  for (const label of ['Search','Schedule','Sign In','Yard Check','Log','DAR'])
    await expect(page.locator('#sec-home .tile', { hasText: label })).toHaveCount(1);
  await expect(page.locator('nav')).toHaveCount(0);          // the old tab bar is gone
  await expect(page.locator('#hdrtitle')).toBeEmpty();       // no wordmark in the bar
  // nothing behind home, so no back arrow; the menu lives on the profile
  await expect(page.locator('#menubtn')).toBeHidden();
  await expect(page.locator('#profbtn')).toBeVisible();
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

test('the menu opens from the profile it belongs to', async ({ page }) => {
  await signedIn(page);
  await expect(page.locator('#drawer')).toBeHidden();
  await expect(page.locator('#profbtn')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#profbtn');
  await expect(page.locator('#drawer')).toBeVisible();
  await expect(page.locator('#profbtn')).toHaveAttribute('aria-expanded', 'true');
  // it hangs under the profile, on the right, not off the side of the screen
  const p = await page.locator('#profbtn').boundingBox();
  const m = await page.locator('#drawer').boundingBox();
  expect(m.y).toBeGreaterThan(p.y + p.height - 2);
  expect(Math.round(m.x + m.width)).toBeGreaterThan(page.viewportSize().width / 2);
  // tapping the profile again puts it away
  await page.click('#profbtn');
  await expect(page.locator('#drawer')).toBeHidden();
});

test('the back arrow appears only where there is something behind', async ({ page }) => {
  await signedIn(page);
  await expect(page.locator('#menubtn')).toBeHidden();
  await page.click('#sec-home .tile[onclick*="log"]');
  await expect(page.locator('#menubtn')).toBeVisible();
  await page.click('#menubtn');
  await expect(page.locator('#sec-home')).toBeVisible();
  await expect(page.locator('#menubtn')).toBeHidden();
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

test('the menu lists every screen it should', async ({ page }) => {
  await signedIn(page);
  await expect(page.locator('#drawer')).toBeHidden();
  await page.click('#profbtn');
  const d = page.locator('#drawer');
  await expect(d).toBeVisible();
  // a menu, not a screen: it does not take the app modal
  await expect(page.locator('#drawer')).not.toHaveAttribute('aria-modal', 'true');
  // the header names the account an inch above; the panel does not repeat it
  await expect(page.locator('#drawer')).not.toContainText('kofi@martinbrower.com');
  // Home is offered from anywhere but the home screen itself
  for (const label of ['Saved forms','Settings','Sign out'])
    await expect(page.locator('.ditem', { hasText: label })).toHaveCount(1);
  // the tiles' own screens are not repeated here
  for (const label of ['Gate log','Yard check','Search','Schedule','DAR'])
    await expect(page.locator('.ditem', { hasText: label })).toHaveCount(0);
  // every item is a comfortable target
  const items = page.locator('.ditem:visible');
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const b = await items.nth(i).boundingBox();
    expect(b.height, `menu item ${i}`).toBeGreaterThanOrEqual(44);
  }
});

test('the menu closes on backdrop, Escape, and on choosing an item', async ({ page }) => {
  await signedIn(page);
  await page.click('#profbtn');
  await page.mouse.click(20, 600);              // anywhere outside the panel
  await expect(page.locator('#drawer')).toBeHidden();

  await page.click('#profbtn');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).toBeHidden();

  await page.click('#profbtn');
  await page.click('.ditem:has-text("Settings")');
  await expect(page.locator('#drawer')).toBeHidden();
  await expect(page.locator('#sec-settings')).toBeVisible();
});

test('opening the menu moves focus into it and restores it on close', async ({ page }) => {
  await signedIn(page);
  await page.click('#profbtn');
  expect(await page.evaluate(() => document.activeElement.className)).toContain('ditem');
  expect(await page.evaluate(() => document.activeElement.hidden)).toBe(false);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('profbtn');
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
  await page.click('#profbtn');
  await expect(page.locator('#drawer')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#drawer')).toBeHidden();
});

test('every tile reaches a real screen', async ({ page }) => {
  await signedIn(page);
  const map = { search:'sec-search', sched:'sec-sched', form:'sec-form',
                yard:'sec-yard', log:'sec-log', dar:'sec-dar' };
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
      await expect(t).toHaveText('Seal Verification');
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

test('the menu does not offer the screen you are already on', async ({ page }) => {
  await signedIn(page);
  await page.click('#profbtn');
  await expect(page.locator('#um_home')).toBeHidden();
  await page.keyboard.press('Escape');

  await page.click('#sec-home .tile[onclick*="log"]');
  await page.click('#profbtn');
  await expect(page.locator('#um_home')).toBeVisible();
  await page.click('#um_home');
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('the menu repeats nothing the header already shows', async ({ page }) => {
  await signedIn(page);
  await page.evaluate(() => {
    sset('gc_offname_kofi@martinbrower.com', 'Kobe Mensah');
    menuFill();
  });
  await expect(page.locator('#hdrname')).toHaveText('Kobe Mensah');
  await expect(page.locator('#hdrmail')).toHaveText('kofi@martinbrower.com');
  await page.click('#profbtn');
  const panel = await page.locator('#drawer').innerText();
  expect(panel).not.toContain('Kobe Mensah');
  expect(panel).not.toContain('kofi@martinbrower.com');
});

test('every menu item leads somewhere that has no tile of its own', async ({ page }) => {
  await signedIn(page);
  await page.click('#sec-home .tile[onclick*="log"]');     // off home, so Home shows
  await page.click('#profbtn');
  const items = await page.locator('.ditem:visible').evaluateAll(
    els => els.map(e => (e.getAttribute('onclick') || '')));
  const tiles = await page.locator('#sec-home .tile').evaluateAll(
    els => els.map(e => (e.getAttribute('onclick') || '')
      .replace(/^go\('|'\)$/g, '')));
  for (const t of tiles)
    expect(items.some(i => i.includes("menuGo('" + t + "')")),
      'the menu repeats the ' + t + ' tile').toBe(false);
});
