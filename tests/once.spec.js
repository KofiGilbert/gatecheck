/* Four Dennis Johns, one truck, 31 August.

   A seal form had no identity: collect() built a timestamp and formCloudPush
   handed it to .add(), which mints a fresh document every time. Pressing
   Submit twice was two trucks as far as the office could tell - and Firestore's
   offline retry can do the same on its own, because every attempt asks for a
   new auto-id. The form carries its own name now and is written with
   .doc(id).set(): the idempotency key, the same answer Stripe gives to double
   charges. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function gate(page) {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'kobe@martinbrower.com'}, role:'officer' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'officer');
  await page.evaluate(() => { go('form'); resetForm(false); });
}
const fill = (page, over) => page.evaluate((o) => {
  $('f_po').value = o.po || '8065385';
  $('f_trailer').value = o.trailer || '5337';
  $('f_carrier').value = 'J&L';
  $('f_driver').value = 'Dennis John';
  $('f_datein').value = todayStr(); $('f_timein').value = '0632';
  setPick('sealcond', 'INTACT');
}, over || {});

test('a form has a name before it is ever sent', async ({ page }) => {
  await gate(page);
  const a = await page.evaluate(() => collect().formId);
  const b = await page.evaluate(() => collect().formId);
  expect(a, 'minted when the blank form opens, not at Submit').toMatch(/^f_/);
  expect(b, 'and it does not change while the same form is being filled').toBe(a);
});

test('starting a new blank form is what mints a new name', async ({ page }) => {
  await gate(page);
  const a = await page.evaluate(() => collect().formId);
  const b = await page.evaluate(() => { resetForm(true); return collect().formId; });
  expect(b).not.toBe(a);
});

test('pressing Submit four times sends one truck', async ({ page }) => {
  await gate(page);
  await fill(page);
  const out = await page.evaluate(async () => {
    window.confirm = () => true;
    for (let i = 0; i < 4; i++) { pushForm(); await new Promise(r => setTimeout(r, 30)); }
    await new Promise(r => setTimeout(r, 400));
    // the stub records every doc().set() in every collection, so pick out the
    // form writes by the name a form carries
    const w = (window.__fb.written || []).filter(x => /^f_/.test(x.id));
    return { writes: w.length, ids: [...new Set(w.map(x => x.id))] };
  });
  // the four Dennis Johns: four presses, four documents, four rows
  expect(out.ids.length, 'every write must land on the same document').toBe(1);
  expect(out.ids[0]).toMatch(/^f_/);
  // and only one write is even attempted: a second .set() on the same id is an
  // UPDATE, which the rules refuse an officer, so sending it would have shown
  // a permissions error for the system working correctly
  expect(out.writes, 'the form is written once').toBe(1);
});

test('pressing Submit again is answered, not sent and refused', async ({ page }) => {
  await gate(page);
  await fill(page);
  const said = await page.evaluate(async () => {
    window.confirm = () => true;
    pushForm();
    await new Promise(r => setTimeout(r, 1400));   // past the double-tap lock
    let msg = '';
    window.alert = (m) => { msg = m; };
    pushForm();
    return { msg, writes: (window.__fb.written || []).filter(w => /^f_/.test(w.id)).length };
  });
  expect(said.msg).toContain('already been sent');
  // it points at the two things that are actually wanted
  expect(said.msg).toContain('Start a new blank form');
  expect(said.msg).toContain('correction');
  expect(said.writes, 'nothing further goes to the office').toBe(1);
});

test('a new blank form can be sent straight after one that was', async ({ page }) => {
  await gate(page);
  await fill(page);
  const out = await page.evaluate(async () => {
    window.confirm = () => true;
    pushForm();
    await new Promise(r => setTimeout(r, 1400));
    resetForm(true);
    $('f_po').value = '8082733'; $('f_trailer').value = '4411';
    $('f_carrier').value = 'TAYLOR FARMS'; setPick('sealcond', 'INTACT');
    pushForm();
    await new Promise(r => setTimeout(r, 400));
    return [...new Set((window.__fb.written || []).filter(w => /^f_/.test(w.id)).map(w => w.id))].length;
  });
  expect(out, 'two trucks are two forms').toBe(2);
});

test('a form is written to its own id, never to a fresh one', async ({ page }) => {
  await gate(page);
  await fill(page);
  const out = await page.evaluate(async () => {
    window.confirm = () => true;
    const id = collect().formId;
    pushForm();
    await new Promise(r => setTimeout(r, 400));
    const w = (window.__fb.written || []).filter(x => /^f_/.test(x.id));
    return { id, wroteTo: w.length ? w[0].id : null,
             added: (window.__fb.added || []).filter(a => a.name === 'forms').length };
  });
  expect(out.wroteTo).toBe(out.id);
  // .add() is what duplicated on an offline retry
  expect(out.added, 'nothing may go through .add()').toBe(0);
});

test('Submit is held shut while it is sending', async ({ page }) => {
  await gate(page);
  await fill(page);
  await page.evaluate(() => { window.confirm = () => true; pushForm(); });
  const b = page.locator('#f_submit');
  await expect(b).toBeDisabled();
  await expect(b).toHaveText('Sending…');
  // and comes back, so a correction can follow
  await expect(b).toBeEnabled({ timeout: 5000 });
  await expect(b).toHaveText('Submit');
});

test('a truck that was just sent is queried, not silently sent again', async ({ page }) => {
  await gate(page);
  await fill(page);
  const asked = await page.evaluate(async () => {
    window.confirm = () => true;
    pushForm();
    // past the double-tap lock, which is all it is for
    await new Promise(r => setTimeout(r, 1400));
    // the stub's snapshot replaces DB.forms with what the "server" holds, so
    // put the sent form back the way a real sync would
    DB.forms = [Object.assign(collect(), { timein: '0632' })];
    // a fresh blank form, same truck typed in again - a different formId, so
    // nothing else would have caught it
    resetForm(true);
    $('f_po').value = '8065385'; $('f_trailer').value = '5337';
    $('f_carrier').value = 'J&L'; $('f_driver').value = 'Dennis John';
    setPick('sealcond', 'INTACT');
    let said = '';
    window.confirm = (m) => { said = m; return false; };
    pushForm();
    return said;
  });
  expect(asked).toContain('8065385');
  expect(asked).toContain('already sent');
});

test('two trailers on one PO are still allowed', async ({ page }) => {
  await gate(page);
  await fill(page);
  const dup = await page.evaluate(async () => {
    window.confirm = () => true;
    pushForm();
    await new Promise(r => setTimeout(r, 1400));
    DB.forms = [Object.assign(collect(), { timein: '0632' })];
    resetForm(true);
    $('f_po').value = '8065385'; $('f_trailer').value = '9999';
    return !!formLooksSent(collect());
  });
  expect(dup, 'same PO, different trailer, is a different truck').toBe(false);
});

/* ---- corrections ---- */
test('a correction is a new form that names the one it replaces', async ({ page }) => {
  await gate(page);
  await fill(page);
  const out = await page.evaluate(async () => {
    window.confirm = () => true;
    pushForm();
    await new Promise(r => setTimeout(r, 400));
    const first = DB.forms[0];
    window.prompt = () => 'seal number was wrong';
    correctHist(0);
    const d = collect();
    return { first: first.formId, now: d.formId, supersedes: d.supersedes,
             reason: d.reason, po: $('f_po').value };
  });
  // the filed record is never edited - it is the thing you would have to
  // produce if a load were disputed
  expect(out.now).not.toBe(out.first);
  expect(out.supersedes).toBe(out.first);
  expect(out.reason).toBe('seal number was wrong');
  expect(out.po, 'the details come across so they are not retyped').toBe('8065385');
});

test('a reason can be skipped without losing that it was corrected', async ({ page }) => {
  await gate(page);
  await fill(page);
  const reason = await page.evaluate(async () => {
    window.confirm = () => true;
    pushForm();
    await new Promise(r => setTimeout(r, 400));
    window.prompt = () => '';
    correctHist(0);
    return collect().reason;
  });
  expect(reason).toBe('corrected, no reason given');
});

test('cancelling the reason corrects nothing', async ({ page }) => {
  await gate(page);
  await fill(page);
  const out = await page.evaluate(async () => {
    window.confirm = () => true;
    pushForm();
    await new Promise(r => setTimeout(r, 400));
    window.prompt = () => null;
    correctHist(0);
    return { supersedes: collect().supersedes, sec: curRoute().sec };
  });
  expect(out.supersedes).toBe('');
});

test('the office sees one row for a corrected form, marked as such', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.evaluate(() => {
    const now = new Date().toISOString();
    DB.forms = [
      { _id:'f_two', formId:'f_two', supersedes:'f_one', reason:'seal was wrong',
        ts: now, po:'8065385', trailer:'5337', carrier:'J&L', driver:'Dennis John' },
      { _id:'f_one', formId:'f_one', ts: now, po:'8065385', trailer:'5337',
        carrier:'J&L', driver:'Dennis John' },
    ];
    go('queue'); renderQueue();
  });
  await expect(page.locator('#queuebody .dayacc')).toHaveCount(1);
  await expect(page.locator('#queuebody .dbconf')).toContainText('Corrected');
  // the superseded one is out of the line, not deleted
  expect(await page.evaluate(() => DB.forms.length)).toBe(2);
});

/* ---- the order the two numbers are asked in ---- */
test('tractor is asked for before trailer', async ({ page }) => {
  await gate(page);
  const order = await page.evaluate(() => {
    const step = document.querySelector('#sec-form .fstep');
    return [...step.querySelectorAll('input, label')]
      .map(e => e.id || e.textContent.trim())
      .filter(t => /tractor|trailer/i.test(t));
  });
  const tractor = order.findIndex(x => /tractor/i.test(x));
  const trailer = order.findIndex(x => /trailer/i.test(x));
  expect(tractor).toBeGreaterThanOrEqual(0);
  expect(trailer).toBeGreaterThanOrEqual(0);
  expect(tractor, 'the tractor number comes first now').toBeLessThan(trailer);
});

test('the NPG hint stays with the field it is about', async ({ page }) => {
  await gate(page);
  // it explains the tractor number, so it has to travel with it rather than
  // sit under whichever field happens to be second
  const between = await page.evaluate(() => {
    const hint = [...document.querySelectorAll('#sec-form .hint')]
      .find(h => /NPG gate log/.test(h.textContent));
    if (!hint) return null;
    const prev = hint.previousElementSibling;
    const next = hint.nextElementSibling;
    return { after: prev && prev.id, beforeLabel: next && next.textContent.trim() };
  });
  expect(between.after).toBe('f_tractor');
  expect(between.beforeLabel).toMatch(/Trailer Number/i);
});

test('the list of empty fields reads down the screen', async ({ page }) => {
  await gate(page);
  const m = await page.evaluate(() => {
    resetForm(false);
    $('f_po').value = '8082733';
    return blankFields();
  });
  const tractor = m.indexOf('Tractor Number');
  const trailer = m.indexOf('Trailer Number');
  expect(tractor).toBeGreaterThanOrEqual(0);
  expect(tractor, 'what is missing is listed in the order it is asked')
    .toBeLessThan(trailer);
});
