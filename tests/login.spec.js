const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.describe('sign-in screen', () => {

  test.beforeEach(async ({ page }) => { await H.gotoApp(page); });

  test('overlay is shown when signed out', async ({ page }) => {
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#lg_form')).toBeVisible();
  });

  /* ---- the original bug: password field had no focus indicator ---- */
  test('both fields get a visible focus indicator', async ({ page }) => {
    for (const sel of ['#lg_email', '#lg_pass']) {
      await page.locator(sel).focus();
      const s = await H.styleOf(page, sel, ['outline-style','outline-width','outline-color']);
      expect(s['outline-style'], `${sel} outline-style`).not.toBe('none');
      expect(parseFloat(s['outline-width']), `${sel} outline-width`).toBeGreaterThanOrEqual(3);
      const ring = H.parseRGB(s['outline-color']);
      const bg = await H.effectiveBg(page, '#login .gc-panel');
      expect(H.ratio(ring, bg), `${sel} focus ring contrast`).toBeGreaterThanOrEqual(3);
    }
  });

  test('password field is styled like the email field (same box)', async ({ page }) => {
    const a = await page.locator('#lg_email').boundingBox();
    const b = await page.locator('#lg_pass').boundingBox();
    expect(Math.abs(a.width - b.width), 'field widths differ').toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height), 'field heights differ').toBeLessThanOrEqual(1);
    expect(b.height).toBeGreaterThanOrEqual(48);
  });

  /* ---- WCAG 1.4.11 non-text contrast: the 1.35:1 border bug ---- */
  test('field borders meet 3:1 non-text contrast', async ({ page }) => {
    for (const sel of ['#lg_email', '#lg_pass']) {
      const s = await H.styleOf(page, sel, ['border-top-color','background-color']);
      const border = H.parseRGB(s['border-top-color']);
      const card = await H.effectiveBg(page, '#login .gc-panel');
      const fill = H.over(H.parseRGB(s['background-color']), card);
      expect(H.ratio(border, card), `${sel} border vs card`).toBeGreaterThanOrEqual(3);
      expect(H.ratio(border, fill), `${sel} border vs own fill`).toBeGreaterThanOrEqual(3);
    }
  });

  /* ---- WCAG 1.4.3 text contrast ---- */
  test('all text meets 4.5:1', async ({ page }) => {
    const targets = [
      '#login h1', '#login .gc-note', '#login .gc-sub',
      '#login label[for=lg_email]', '#login label[for=lg_pass]',
      '#login .gc-cta', '#login .gc-link', '#login .gc-foot', '#login .gc-reveal',
    ];
    const fails = [];
    for (const sel of targets) {
      const s = await H.styleOf(page, sel, ['color']);
      const fg = H.parseRGB(s.color);
      const bg = await H.effectiveBg(page, sel);
      const r = H.ratio(fg, bg);
      if (r < 4.5) fails.push(`${sel}: ${r.toFixed(2)}:1`);
    }
    expect(fails, 'text contrast failures').toEqual([]);
  });

  /* ---- WCAG 2.5.8 target size ---- */
  test('interactive targets are large enough', async ({ page }) => {
    const mins = { '#lg_email':48, '#lg_pass':48, '#lg_btn':48, '#lg_reveal':44, '#login .gc-link':44 };
    for (const [sel, min] of Object.entries(mins)) {
      const bb = await page.locator(sel).boundingBox();
      expect(bb.height, `${sel} height`).toBeGreaterThanOrEqual(min);
      expect(bb.width, `${sel} width`).toBeGreaterThanOrEqual(44);
    }
  });

  /* ---- iOS auto-capitalisation bug ---- */
  test('email field has the mobile attributes that prevent bad input', async ({ page }) => {
    const a = await page.locator('#lg_email').evaluate(el => ({
      type: el.type, autocapitalize: el.getAttribute('autocapitalize'),
      autocorrect: el.getAttribute('autocorrect'), spellcheck: el.getAttribute('spellcheck'),
      autocomplete: el.getAttribute('autocomplete'), name: el.getAttribute('name'),
      required: el.hasAttribute('required'),
    }));
    expect(a.type).toBe('email');
    expect(a.autocapitalize).toBe('none');
    expect(a.autocorrect).toBe('off');
    expect(a.spellcheck).toBe('false');
    expect(a.autocomplete).toBe('username');
    expect(a.name).toBe('email');
    expect(a.required).toBe(true);
    const p = await page.locator('#lg_pass').evaluate(el => ({
      autocomplete: el.getAttribute('autocomplete'), name: el.getAttribute('name'),
    }));
    expect(p.autocomplete).toBe('current-password');
    expect(p.name).toBe('password');
  });

  /* ---- WCAG 1.4.4: pinch zoom must not be blocked ---- */
  test('viewport does not block zoom', async ({ page }) => {
    const c = await page.locator('meta[name=viewport]').getAttribute('content');
    expect(c).not.toContain('user-scalable=no');
    expect(c).not.toContain('maximum-scale=1');
  });

  /* ---- WCAG 4.1.3: status messages ---- */
  test('error region is an announced live region', async ({ page }) => {
    const live = page.locator('#loginerr').locator('xpath=ancestor-or-self::*[@aria-live][1]');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveAttribute('role', 'status');
    const hidden = await live.evaluate(el => getComputedStyle(el).display);
    expect(hidden, 'live region itself must stay in the a11y tree').not.toBe('none');
  });
});
