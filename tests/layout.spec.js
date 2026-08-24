const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.describe('layout, keyboard and regressions', () => {

  test('no horizontal scroll at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await H.gotoApp(page);
    const o = await page.evaluate(() => {
      const el = document.getElementById('login');
      return { sw: el.scrollWidth, cw: el.clientWidth,
               docSW: document.documentElement.scrollWidth, docCW: document.documentElement.clientWidth };
    });
    expect(o.sw, 'overlay overflows horizontally').toBeLessThanOrEqual(o.cw + 1);
    expect(o.docSW).toBeLessThanOrEqual(o.docCW + 1);
  });

  test('card is horizontally centred', async ({ page }) => {
    await H.gotoApp(page);
    const m = await page.evaluate(() => {
      const c = document.querySelector('#login .gc-form-wrap').getBoundingClientRect();
      const p = document.querySelector('#login .gc-panel').getBoundingClientRect();
      return { left: c.left - p.left, right: p.right - c.right };
    });
    expect(Math.abs(m.left - m.right), 'form not centred in its panel').toBeLessThanOrEqual(2);
  });

  /* ---- WCAG 2.4.11: field must be reachable when the keyboard eats the viewport ---- */
  test('password field can be scrolled clear of a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 300 });   // ~iPhone with keyboard up
    await H.gotoApp(page);
    const panel = page.locator('#login .gc-panel');   // the scroll container
    expect(await panel.evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
    const scrollable = await panel.evaluate(el => el.scrollHeight > el.clientHeight);
    expect(scrollable, 'panel must scroll when content exceeds the viewport').toBe(true);

    // nothing is clipped off the top (the align-items:center failure mode)
    const topClip = await page.evaluate(() => {
      const el = document.querySelector('#login .gc-panel');
      el.scrollTop = 0;
      const p = el.getBoundingClientRect();
      return document.querySelector('#login .gc-form-wrap').getBoundingClientRect().top - p.top;
    });
    expect(topClip, 'card top is cut off and unreachable').toBeGreaterThanOrEqual(-1);

    await page.locator('#lg_pass').scrollIntoViewIfNeeded();
    const vis = await page.evaluate(() => {
      const r = document.getElementById('lg_pass').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    expect(vis, 'password field cannot be brought fully into view').toBe(true);
  });

  test('focusing a field scrolls it into view', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 320 });
    await H.gotoApp(page);
    await page.locator('#lg_pass').focus();
    await page.waitForTimeout(150);
    const r = await page.locator('#lg_pass').boundingBox();
    expect(r, 'field has no box').not.toBeNull();
    expect(r.y).toBeGreaterThanOrEqual(-1);
    expect(r.y + r.height).toBeLessThanOrEqual(320 + 1);
  });

  /* ---- tab order ---- */
  test('tab order follows visual order', async ({ page, browserName }) => {
    // Safari omits <button> from sequential focus unless full keyboard access is on.
    // That is a platform default, not a property of this markup.
    test.skip(browserName === 'webkit', 'WebKit excludes buttons from tab order by default');
    await H.gotoApp(page);
    await page.locator('#lg_email').focus();
    const order = ['lg_email'];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.className));
    }
    expect(order.slice(0,4)).toEqual(['lg_email','lg_pass','lg_reveal','lg_btn']);
  });

  test('every control is programmatically focusable and in DOM order', async ({ page }) => {
    await H.gotoApp(page);
    const ids = ['lg_email','lg_pass','lg_reveal','lg_btn'];
    for (const id of ids) {
      await page.locator('#' + id).focus();
      expect(await page.evaluate(() => document.activeElement.id), id).toBe(id);
    }
    const domOrder = await page.evaluate(() =>
      [...document.querySelectorAll('#login input, #login button')].map(e => e.id || e.className));
    expect(domOrder.slice(0, ids.length)).toEqual(ids);
    // the account list is reachable from the box it belongs to
    await page.evaluate(() => { sset('gc_emails', JSON.stringify(['a@b.com'])); });
    await page.locator('#lg_email').fill('');
    await page.locator('#lg_email').click();
    await expect(page.locator('#lg_sugg .gc-sugg-pick').first()).toBeVisible();
    const negative = await page.evaluate(() =>
      [...document.querySelectorAll('#login input, #login button')].filter(e => e.tabIndex < 0).length);
    expect(negative, 'nothing may be removed from the focus order').toBe(0);
  });

  /* ---- regression: login CSS must not leak into the app ---- */
  test('app renders normally after sign-in', async ({ page }) => {
    await H.gotoApp(page);
    await page.fill('#lg_email', 'kofi@martinbrower.com');
    await page.fill('#lg_pass', 'good');
    await page.click('#lg_btn');
    await expect(page.locator('#login')).toBeHidden();
    // the back arrow is hidden on home, where there is nothing to go back to
    await expect(page.locator('#menubtn')).toBeHidden();
    await page.evaluate(() => go('search'));
    await expect(page.locator('#menubtn')).toBeVisible();
    await page.evaluate(() => go('home'));
    // sign out lives in the account dropdown under the profile, on the right
    await page.click('#profbtn');
    await expect(page.locator('.ditem:has-text("Sign out")')).toBeVisible();
    await page.keyboard.press('Escape');
    // a .btn elsewhere in the app keeps its own styling
    await page.click('#sec-home .tile[onclick*=\"sched\"]');
    const btn = page.locator('#sec-sched .btn').first();
    const s = await H.styleOf(page, '#sec-sched .btn', ['background-color','border-radius','min-height']);
    expect(s['border-radius']).toBe('10px');       // app default, not the login CTA's 12px
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.waitForTimeout(200);
    expect(errs).toEqual([]);
  });

  test('no console or page errors on the sign-in screen', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await H.gotoApp(page);
    await page.fill('#lg_email', 'a@b.com');
    await page.click('#lg_reveal');
    await page.waitForTimeout(300);
    expect(errs).toEqual([]);
  });

  /* ---- dark mode ---- */
  test('dark mode keeps contrast', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await H.gotoApp(page);
    const targets = ['#login h1','#login .gc-note','#login label[for=lg_email]','#login .gc-cta','#login .gc-link'];
    const fails = [];
    for (const sel of targets) {
      const s = await H.styleOf(page, sel, ['color']);
      const bg = await H.effectiveBg(page, sel);
      const r = H.ratio(H.parseRGB(s.color), bg);
      if (r < 4.5) fails.push(`${sel}: ${r.toFixed(2)}:1`);
    }
    expect(fails, 'dark-mode text contrast failures').toEqual([]);
    const b = await H.styleOf(page, '#lg_email', ['border-top-color']);
    const card = await H.effectiveBg(page, '#login .gc-panel');
    expect(H.ratio(H.parseRGB(b['border-top-color']), card), 'dark border contrast').toBeGreaterThanOrEqual(3);
  });

  test('reduced motion is respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await H.gotoApp(page);
    const d = await H.styleOf(page, '#login .gc-form-wrap', ['animation-duration']);
    expect(parseFloat(d['animation-duration'])).toBeLessThan(0.05);
    await page.locator('#login .gc-form-wrap').evaluate(el =>
      Promise.all(el.getAnimations().map(a => a.finished.catch(()=>{}))));
    const vis = await page.locator('#login .gc-form-wrap').evaluate(el => getComputedStyle(el).opacity);
    expect(parseFloat(vis), 'card must still be visible with reduced motion').toBe(1);
  });
});

/* ---- the rules in UI.md, enforced ---- */

test('there is one primary button colour, and it is not a state colour', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  const c = await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = 'x';
    document.body.appendChild(b);
    const bg = getComputedStyle(b).backgroundColor;
    b.remove();
    const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return { bg, blue: v('--blue'), green: v('--green'), red: v('--red') };
  });
  const hex = (s) => { const m = s.match(/\d+/g); return m
    ? '#' + m.slice(0,3).map(n => (+n).toString(16).padStart(2,'0')).join('') : s; };
  expect(hex(c.bg)).toBe(c.blue.toLowerCase());
  expect(hex(c.bg)).not.toBe(c.green.toLowerCase());
  expect(hex(c.bg)).not.toBe(c.red.toLowerCase());
  // and no green button survives anywhere
  expect(await page.locator('.btn.grn').count()).toBe(0);
});

test('every button reacts to a hover, a press and a keyboard focus', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  const rules = await page.evaluate(() => {
    const want = ['.btn:hover', '.btn:active', '.btn:focus-visible',
                  '.btn.sec:hover', '.btn.red:hover'];
    const all = [];
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules; } catch (e) { continue; }
      for (const r of list) if (r.selectorText) all.push(r.selectorText);
    }
    return want.filter(w => !all.some(s => s.split(',').map(x => x.trim()).includes(w)));
  });
  expect(rules, 'these button states have no rule').toEqual([]);
});

test('a disabled button says why, rather than sitting dead', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => {
    sset('gc_offname_kofi@martinbrower.com','Kobe');
    darBuild(); darOver = function(){ return false; }; go('dar');
  });
  const b = page.locator('#dar_submit');
  await expect(b).toBeDisabled();
  expect(await b.evaluate(e => getComputedStyle(e).cursor)).toBe('not-allowed');
  // the reason lives beside the button, not inside its label
  await expect(page.locator('#dar_why')).toBeVisible();
  expect((await b.innerText()).length, 'the label is a label, not a sentence')
    .toBeLessThan(24);
});

test('a primary button is full width wherever it appears', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => {
    const slot = ycShiftSlots()[2], date = ycSlotDate(slot);
    DB.yardslots = [{ id:date+'_'+slot, date, slot, loadedAt:new Date().toISOString(),
      count:1, trailers:[{trailer:'AAA111',product:'FRIES'}] }];
    ycSlotsPersist(); DB.yardchecks = []; go('yard'); ycOpenSlot(slot);
  });
  await page.locator('#ycgridwrap .ycgtile').nth(0).click();
  await page.selectOption('#ycm_set', '-10');
  await page.fill('#ycm_temp', '-9.0');
  await page.selectOption('#ycm_fuel', 'FULL');
  await page.selectOption('#ycm_intact', 'Y');
  await page.selectOption('#ycm_door', '20');
  await page.click('#ycm_save');

  const btn = await page.locator('#ycg_review').boundingBox();
  const host = await page.locator('#ycgridwrap').boundingBox();
  expect(Math.round(btn.width), 'the review button is not the app’s button width')
    .toBe(Math.round(host.width));
});
