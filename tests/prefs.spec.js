const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* Each of these earns its place from how the app is used: a night shift, a
   gloved hand outdoors, a form that must be known to have gone, an hour spent
   on the gate log. */

const onSettings = async (page) => {
  await H.gotoApp(page, { user:{ email:'kofi@martinbrower.com' }, role:'officer' });
  await page.evaluate(() => go('settings'));
  await expect(page.locator('#prefsbody')).toBeVisible();
};

/* ---- appearance ---- */

test('dark turns the app dark and survives a refresh', async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  expect(await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'))).toBe('dark');

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = (c) => { const n = c.match(/\d+/g).map(Number);
    return (0.2126*n[0] + 0.7152*n[1] + 0.0722*n[2]) / 255; };
  expect(lum(bg), 'the page is still light').toBeLessThan(0.25);

  await page.reload();
  expect(await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'))).toBe('dark');
});

test('match device follows the device, and sets nothing of its own', async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  await page.click('.pseg-b:has-text("Match device")');
  expect(await page.evaluate(() =>
    document.documentElement.hasAttribute('data-theme'))).toBe(false);

  await page.emulateMedia({ colorScheme: 'dark' });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const n = bg.match(/\d+/g).map(Number);
  expect((0.2126*n[0] + 0.7152*n[1] + 0.0722*n[2]) / 255).toBeLessThan(0.25);
});

test('the printed sheets stay on paper white, whatever the theme', async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  await page.evaluate(() => {
    sset('gc_offname_kofi@martinbrower.com','Kobe');
    darBuild(); go('dar');
  });
  const paper = await page.locator('.darpaper')
    .evaluate(el => getComputedStyle(el).backgroundColor);
  const n = paper.match(/\d+/g).map(Number);
  // it gets emailed and printed: paper is not dark
  expect((0.2126*n[0] + 0.7152*n[1] + 0.0722*n[2]) / 255).toBeGreaterThan(0.9);
});

test('the browser chrome follows the app into the dark', async ({ page }) => {
  await onSettings(page);
  const light = await page.locator('meta[name="theme-color"]').getAttribute('content');
  await page.click('.pseg-b:has-text("Dark")');
  const dark = await page.locator('meta[name="theme-color"]').getAttribute('content');
  expect(dark).not.toBe(light);
});

/* ---- text size ---- */

test('larger text makes everything larger, not just some of it', async ({ page }) => {
  await onSettings(page);
  const before = await page.locator('#prefsbody .ptext b').first().boundingBox();
  await page.click('.pseg-b:has-text("Larger")');
  const after = await page.locator('#prefsbody .ptext b').first().boundingBox();
  expect(after.height).toBeGreaterThan(before.height);
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()))
    .toBe('1.25');
});

/* ---- sound ---- */

test('sound is on by default and can be turned off', async ({ page }) => {
  await onSettings(page);
  const sw = page.locator('.pswitch[aria-label="Sound on save"]');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(page.locator('.pswitch[aria-label="Sound on save"]'))
    .toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => PREFS.sound)).toBe(false);
  // and it stays off
  await page.reload();
  expect(await page.evaluate(() => PREFS.sound)).toBe(false);
});

test('a silenced app makes no sound when a form goes', async ({ page }) => {
  await onSettings(page);
  await page.evaluate(() => { PREFS.sound = false; window.__rang = 0;
    const real = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = function(){ window.__rang++; return new real(); };
  });
  await page.evaluate(() => beep());
  expect(await page.evaluate(() => window.__rang)).toBe(0);
});

/* ---- installing ---- */

test('the app is installable: a manifest, an icon and a service worker',
  async ({ page, request }) => {
  await onSettings(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();

  const m = await (await request.get(new URL(href, page.url()).href)).json();
  expect(m.name).toBe('Checkpoint');
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBeTruthy();
  expect(m.icons.length).toBeGreaterThan(0);
  expect(m.icons.some(i => i.purpose && i.purpose.includes('maskable'))).toBe(true);

  const icon = await request.get(new URL(m.icons[0].src, page.url()).href);
  expect(icon.ok()).toBe(true);
  const sw = await request.get(new URL('sw.js', page.url()).href);
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain('addEventListener');
});

test('the service worker never comes between the app and its data', async ({ request, page }) => {
  await onSettings(page);
  const sw = await (await request.get(new URL('sw.js', page.url()).href)).text();
  // a cached gate log row would be worse than none
  expect(sw).toMatch(/googleapis|firebase/);
  expect(sw).toContain("e.request.method !== 'GET'");
});

/* ---- the settings screen itself ---- */

test('every setting says what it is for', async ({ page }) => {
  await onSettings(page);
  const rows = page.locator('#prefsbody .prow');
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < await rows.count(); i++) {
    const note = await rows.nth(i).locator('.ptext span').count();
    expect(note, `row ${i} has no explanation`).toBe(1);
  }
});

test('a switch is a real switch to a screen reader', async ({ page }) => {
  await onSettings(page);
  const sw = page.locator('.pswitch').first();
  await expect(sw).toHaveAttribute('role', 'switch');
  await expect(sw).toHaveAttribute('aria-checked', /true|false/);
  const box = await sw.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
});

test('nothing on a dark card is written in a colour that stayed light-mode',
  async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  const bad = await page.evaluate(() => {
    const lum = (c) => { const n = (c.match(/\d+/g)||[0,0,0]).map(Number);
      const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
      return 0.2126*f(n[0]) + 0.7152*f(n[1]) + 0.0722*f(n[2]); };
    const out = [];
    document.querySelectorAll('section.on *').forEach(el => {
      const t = [...el.childNodes].filter(n => n.nodeType===3 && n.textContent.trim());
      if (!t.length) return;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      let p = el, bg = 'rgba(0, 0, 0, 0)';
      while (p && bg === 'rgba(0, 0, 0, 0)') { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; }
      const a = lum(s.color), b = lum(bg);
      const ratio = (Math.max(a,b)+0.05) / (Math.min(a,b)+0.05);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5))
        out.push((el.tagName + '.' + el.className).slice(0,40) + ' ' +
                 t.map(n=>n.textContent.trim()).join('').slice(0,20) +
                 ' ' + ratio.toFixed(1) + ':1');
    });
    return out;
  });
  expect(bad, 'unreadable in dark mode').toEqual([]);
});

/* ---- dark mode: elevation, not white ---- */

test('nothing the officer types into is white in the dark', async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  await page.evaluate(() => go('form'));
  const whites = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#sec-form input, #sec-form select, #sec-form textarea')
      .forEach(el => {
        const c = getComputedStyle(el).backgroundColor;
        const n = (c.match(/\d+/g) || [0,0,0]).map(Number);
        if (n[0] > 230 && n[1] > 230 && n[2] > 230)
          out.push((el.id || el.className || el.tagName) + ' ' + c);
      });
    return out;
  });
  expect(whites, 'a white box on a dark card').toEqual([]);
});

test('the yard check search box is a control, not a sheet of paper', async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  await page.evaluate(() => { go('yard'); ycOpenSlot(ycShiftSlots()[2]); });
  const c = await page.locator('#ycg_q').evaluate(el => getComputedStyle(el).backgroundColor);
  const n = c.match(/\d+/g).map(Number);
  expect(Math.max(...n.slice(0,3)), 'the search box is still white').toBeLessThan(200);
});

test('tapping a tile does not flash light', async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  await page.evaluate(() => go('home'));
  const press = await page.locator('#sec-home .tile').first().evaluate(el => {
    // the :active colour is a token, so it follows the theme
    return getComputedStyle(document.documentElement).getPropertyValue('--press').trim();
  });
  const n = press.replace('#','').match(/.{2}/g).map(h => parseInt(h,16));
  expect(Math.max(...n), 'the press state is a light flash').toBeLessThan(80);
});

test('the printed sheets are still paper, on purpose', async ({ page }) => {
  await onSettings(page);
  await page.click('.pseg-b:has-text("Dark")');
  await page.evaluate(() => {
    sset('gc_offname_kofi@martinbrower.com','Kobe'); darBuild(); go('dar');
  });
  const c = await page.locator('.darpaper').evaluate(el => getComputedStyle(el).backgroundColor);
  const n = c.match(/\d+/g).map(Number);
  // it gets emailed and printed; a printed page is white
  expect(Math.min(...n.slice(0,3))).toBeGreaterThan(240);
});

/* ---- saved forms ---- */

test('saved forms are grouped by day, newest first', async ({ page }) => {
  await H.gotoApp(page, { user:{ email:'kofi@martinbrower.com' }, role:'officer' });
  await page.evaluate(() => {
    DB.forms = [
      { po:'1', datein:'8/21/26', timein:'0900', carrier:'J&L', driver:'A', sealcond:'INTACT' },
      { po:'2', datein:'8/23/26', timein:'0700', carrier:'POPE', driver:'B', sealcond:'INTACT' },
      { po:'3', datein:'8/23/26', timein:'1800', carrier:'GENEVA', driver:'C', sealcond:'BROKEN' },
    ];
    go('hist');
  });
  const days = page.locator('#hist .hday');
  await expect(days).toHaveCount(2);
  await expect(days.nth(0).locator('.hdayhd b')).toHaveText('Sunday, August 23, 2026');
  await expect(days.nth(0).locator('.hdayhd span')).toHaveText('2 forms');
  await expect(days.nth(1).locator('.hdayhd b')).toHaveText('Friday, August 21, 2026');

  // newest first inside the day too
  const times = await days.nth(0).locator('.htime').allInnerTexts();
  expect(times).toEqual(['1800', '0700']);

  // a seal that was not intact is called out
  await expect(days.nth(0).locator('.hseal').first()).toHaveText('BROKEN');
  await expect(days.nth(0).locator('.hseal').first()).toHaveClass(/bad/);
});

test('the buttons on a saved form say what they do', async ({ page }) => {
  await H.gotoApp(page, { user:{ email:'kofi@martinbrower.com' }, role:'officer' });
  await page.evaluate(() => {
    DB.forms = [{ po:'8055968', datein:'8/23/26', timein:'0700', carrier:'POPE',
                  driver:'A', sealcond:'INTACT' }];
    go('hist');
  });
  const btns = page.locator('#hist .hbtn');
  await expect(btns).toHaveCount(3);
  for (let i = 0; i < 3; i++)
    await expect(btns.nth(i)).toHaveAttribute('aria-label', /8055968/);
});
