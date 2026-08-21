const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.describe('sign-in behaviour', () => {

  test('form submits on Enter from the email field', async ({ page }) => {
    await H.gotoApp(page, { authError: 'auth/invalid-credential' });
    await page.fill('#lg_email', 'kofi@martinbrower.com');
    await page.fill('#lg_pass', 'hunter2');
    await page.locator('#lg_email').press('Enter');
    await expect(page.locator('#loginerr')).not.toBeEmpty();
  });

  test('submitting fires doLogin exactly once', async ({ page }) => {
    await H.gotoApp(page, { authError: 'auth/invalid-credential' });
    await page.evaluate(() => {
      window.__calls = 0;
      const orig = window.doLogin;
      window.doLogin = function(){ window.__calls++; return orig.apply(this, arguments); };
    });
    await page.fill('#lg_email', 'a@b.com');
    await page.fill('#lg_pass', 'x');
    await page.click('#lg_btn');
    await expect(page.locator('#loginerr')).not.toBeEmpty();
    expect(await page.evaluate(() => window.__calls)).toBe(1);
  });

  test('error state: red treatment with "!" icon, no ok class', async ({ page }) => {
    await H.gotoApp(page, { authError: 'auth/invalid-credential' });
    await page.fill('#lg_email', 'a@b.com');
    await page.fill('#lg_pass', 'wrong');
    await page.click('#lg_btn');
    const msg = page.locator('#loginerr');
    await expect(msg).toBeVisible();
    await expect(msg).not.toHaveClass(/ok/);
    await expect(msg).toContainText("don't match");
    const icon = await H.pseudo(page, '#loginerr', '::before', ['content','background-color']);
    expect(icon.content).toContain('!');
    const s = await H.styleOf(page, '#loginerr', ['color','background-color']);
    const bg = await H.effectiveBg(page, '#loginerr');
    expect(H.ratio(H.parseRGB(s.color), bg)).toBeGreaterThanOrEqual(4.5);
    const bar = H.parseRGB(icon['background-color']);
    expect(H.ratio(bar, bg), 'error icon vs its tint').toBeGreaterThanOrEqual(3);
  });

  test('no raw Firebase codes leak for mapped errors', async ({ page }) => {
    for (const code of ['auth/invalid-credential','auth/too-many-requests',
                        'auth/network-request-failed','auth/user-disabled','auth/invalid-email']) {
      await H.gotoApp(page, { authError: code });
      await page.fill('#lg_email', 'a@b.com');
      await page.fill('#lg_pass', 'x');
      await page.click('#lg_btn');
      const t = await page.locator('#loginerr').textContent();
      expect(t, `message for ${code}`).not.toContain('auth/');
      expect(t).not.toContain('Firebase');
      expect(t.length).toBeGreaterThan(20);
    }
  });

  test('credential errors are indistinguishable (no account enumeration)', async ({ page }) => {
    const seen = [];
    for (const code of ['auth/invalid-credential','auth/user-not-found','auth/wrong-password']) {
      await H.gotoApp(page, { authError: code });
      await page.fill('#lg_email', 'a@b.com');
      await page.fill('#lg_pass', 'x');
      await page.click('#lg_btn');
      seen.push(await page.locator('#loginerr').textContent());
    }
    expect(new Set(seen).size, 'all three must produce one identical string').toBe(1);
  });

  /* ---- the bug where a sent reset link looked like a failure ---- */
  test('reset success is green with a check, and echoes the address', async ({ page }) => {
    await H.gotoApp(page);
    await page.fill('#lg_email', 'kofi@martinbrower.com');
    await page.click('#login .gc-link');
    const msg = page.locator('#loginerr');
    await expect(msg).toHaveClass(/ok/);
    await expect(msg).toContainText('kofi@martinbrower.com');
    const icon = await H.pseudo(page, '#loginerr', '::before', ['content','background-color']);
    expect(icon.content).toContain('✓');
    const okBg = await H.effectiveBg(page, '#loginerr');
    const s = await H.styleOf(page, '#loginerr', ['color']);
    expect(H.ratio(H.parseRGB(s.color), okBg)).toBeGreaterThanOrEqual(4.5);
    // must be visually distinct from the error treatment
    const errPage = okBg;
    await page.reload();
    await page.waitForFunction(() => typeof window.doLogin === 'function');
    await page.click('#login .gc-link');           // no email -> error styling
    await expect(page.locator('#loginerr')).not.toHaveClass(/ok/);
    const errBg = await H.effectiveBg(page, '#loginerr');
    expect(JSON.stringify(errBg)).not.toBe(JSON.stringify(errPage));
  });

  test('reset failure is mapped, not raw', async ({ page }) => {
    await H.gotoApp(page, { resetError: 'auth/network-request-failed' });
    await page.fill('#lg_email', 'a@b.com');
    await page.click('#login .gc-link');
    const msg = page.locator('#loginerr');
    await expect(msg).not.toHaveClass(/ok/);
    const t = await msg.textContent();
    expect(t).not.toContain('auth/');
    expect(t).toContain('connection');
  });

  /* ---- loading state ---- */
  test('loading state is readable, not just dimmed', async ({ page }) => {
    await H.gotoApp(page, { pending: true });
    await page.fill('#lg_email', 'a@b.com');
    await page.fill('#lg_pass', 'x');
    await page.click('#lg_btn');
    await expect(page.locator('#lg_btn')).toBeDisabled();
    await expect(page.locator('#lg_btn .gc-busy')).toBeVisible();
    await expect(page.locator('#lg_btn .gc-idle')).toBeHidden();
    await expect(page.locator('#lg_btn')).toContainText('Signing in');
    const s = await H.styleOf(page, '#lg_btn', ['opacity','background-color','color']);
    expect(parseFloat(s.opacity), 'must override the global .btn:disabled{opacity:.45}').toBe(1);
    const r = H.ratio(H.parseRGB(s.color), H.parseRGB(s['background-color']));
    expect(r, 'loading label contrast').toBeGreaterThanOrEqual(4.5);
  });

  /* ---- show / hide password ---- */
  test('show/hide toggles type, aria-pressed, label and keeps focus', async ({ page }) => {
    await H.gotoApp(page);
    await page.fill('#lg_pass', 'secret123');
    const pass = page.locator('#lg_pass'), rev = page.locator('#lg_reveal');
    await expect(pass).toHaveAttribute('type', 'password');
    await expect(rev).toHaveAttribute('aria-pressed', 'false');
    await rev.click();
    await expect(pass).toHaveAttribute('type', 'text');
    await expect(rev).toHaveAttribute('aria-pressed', 'true');
    await expect(rev).toHaveAttribute('aria-label', 'Hide password');
    await expect(rev).toHaveText('Hide');
    expect(await page.evaluate(() => document.activeElement.id), 'focus returns to input').toBe('lg_pass');
    expect(await page.evaluate(() => document.getElementById('lg_pass').selectionStart)).toBe(9);
    await rev.click();
    await expect(pass).toHaveAttribute('type', 'password');
    await expect(rev).toHaveText('Show');
  });

  test('reveal button does not submit the form', async ({ page }) => {
    await H.gotoApp(page, { authError: 'auth/invalid-credential' });
    await page.fill('#lg_pass', 'x');
    await page.click('#lg_reveal');
    await expect(page.locator('#loginerr')).toBeEmpty();
  });

  /* ---- focus containment ---- */
  test('app behind the overlay is inert, and released after sign-in', async ({ page }) => {
    await H.gotoApp(page);
    const inertCount = await page.evaluate(() =>
      [...document.body.children].filter(el => el.id !== 'login' && el.tagName !== 'SCRIPT' && el.hasAttribute('inert')).length);
    expect(inertCount).toBeGreaterThan(0);
    const leaked = await page.evaluate(() =>
      [...document.body.children].filter(el => el.id !== 'login' && el.tagName !== 'SCRIPT' && !el.hasAttribute('inert')).map(e => e.tagName + '#' + e.id));
    expect(leaked, 'every non-login top-level element must be inert').toEqual([]);

    await page.fill('#lg_email', 'kofi@martinbrower.com');
    await page.fill('#lg_pass', 'good');
    await page.click('#lg_btn');
    await expect(page.locator('#login')).toBeHidden();
    const stillInert = await page.evaluate(() =>
      [...document.body.children].filter(el => el.hasAttribute('inert')).length);
    expect(stillInert, 'inert must be released after sign-in').toBe(0);
    // the signed-in identity now lives in the slide-in menu
  await expect(page.locator('#hdrmail')).toHaveText('kofi@martinbrower.com');
  });
});
