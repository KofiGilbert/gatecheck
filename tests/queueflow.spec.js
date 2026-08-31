/* Serving a driver, in the three steps it actually takes.

   "Serve" was an imperative sitting on an action that ended the service rather
   than starting it, so pressing it read as being told the job was already
   done. Call next opens the driver's form and stands them at the window;
   Mark served is what finishes them. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const FORMS = [
  { _id:'f1', ts:'2026-08-30T15:31:00.000Z', carrier:'GH',    driver:'Kofi Gilbert',
    po:'8054736', trailer:'1234', sealcond:'INTACT' },
  { _id:'f2', ts:'2026-08-30T15:32:00.000Z', carrier:'J&L',   driver:'Kofi',
    po:'8055447', trailer:'1234', sealcond:'INTACT' },
  { _id:'f3', ts:'2026-08-30T15:38:00.000Z', carrier:'SWIFT', driver:'M. Osei',
    po:'8055512', trailer:'9001', sealcond:'BROKEN' },
];

async function queue(page) {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.evaluate((forms) => {
    // stamped now, so they fall inside the queue's own time window
    DB.forms = forms.map((f, i) => ({ ...f, ts: new Date(Date.now() - (30 - i) * 60000).toISOString() }));
    go('queue'); renderQueue();
  }, FORMS);
}
const rows = page => page.locator('#queuebody .dayacc');

test('the button says Serve, and now that is what it does', async ({ page }) => {
  await queue(page);
  // the word was never the problem: the old Serve quietly finished a driver
  // instead of starting them. It opens their form and brings them to the
  // window now, which is what the imperative promised all along.
  for (const i of [0, 1])
    await expect(rows(page).nth(i).locator('.qserve')).toHaveText('Serve');
});

test('the place in the line is a numeral you can read', async ({ page }) => {
  await queue(page);
  // it used to be "#1 - NEXT - 15:31" run together in 9.5px grey, so you could
  // not tell the list was numbered at all, let alone who was next
  const pos = rows(page).first().locator('.qpos');
  await expect(pos.locator('b')).toHaveText('1');
  await expect(pos.locator('i')).toHaveText('NEXT');
  await expect(rows(page).nth(1).locator('.qpos b')).toHaveText('2');
  await expect(rows(page).nth(1).locator('.qpos i')).toHaveCount(0);
  const size = await pos.locator('b').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThan(16);
});

test('serving a driver stands them at the window and opens their form', async ({ page }) => {
  await queue(page);
  await rows(page).first().locator('.qserve').click();
  // the form opens, because you cannot serve a driver without reading it
  await expect(page.locator('#fqview')).toBeVisible();
  await expect(page.locator('#fqview_title')).toContainText('GH');
  // and the action to finish them is on the sheet you are already looking at
  await expect(page.locator('#fqview_body .qact')).toContainText('At the window since');
  await expect(page.locator('#fqview_body .qact .qserve').last()).toHaveText('Mark served');
  await page.evaluate(() => queueViewClose());
  await expect(page.locator('#queuebody .qsep').first()).toHaveText('At the window');
  await expect(page.locator('#queuebody .dayacc.qserving')).toHaveCount(1);
  await expect(page.locator('#queuebody .dayacc.qserving .qserve:not(.ghost)')).toHaveText('Mark served');
  await expect(page.locator('#queuebody .dayacc.qserving .qserve.ghost')).toHaveText('Open');
});

test('one window, one driver at it', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); });
  await page.evaluate(() => { queueCall('f2'); queueViewClose(); });
  await expect(page.locator('#queuebody .dayacc.qserving')).toHaveCount(1);
  await expect(page.locator('#queuebody .dayacc.qserving')).toContainText('J&L');
  // the one who was there goes back to the line, not into thin air
  const state = await page.evaluate(() => ({
    waiting: queueWaiting().map(f => f.carrier),
    at: queueServing().map(f => f.carrier),
  }));
  expect(state.at).toEqual(['J&L']);
  expect(state.waiting).toContain('GH');
});

test('marking served offers the undo there and then', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); });
  await page.locator('#queuebody .dayacc.qserving .qserve:not(.ghost)').click();
  // the escape hatch is at the moment of the action, not filed behind it
  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/show/);
  await expect(toast).toContainText('GH marked served');
  await expect(toast.locator('.tundo')).toHaveText('Undo');
  await toast.locator('.tundo').click();
  // and it puts them back where the mistake was made - at the window
  await expect(page.locator('#queuebody .dayacc.qserving')).toContainText('GH');
});

test('a served driver drops into Served today with a way back', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); queueServe('f1'); });
  await expect(page.locator('#queuebody .dayacc.qdone')).toHaveCount(1);
  await expect(page.locator('#queuebody .dayacc.qdone')).toContainText('GH');
  await expect(page.locator('#queuebody .dayacc.qdone .qserve.undo')).toHaveText('Undo');
  await expect(page.locator('#queuebody .dayacc.qdone .qserve.ghost')).toHaveText('Open');
});

test('the count is who is waiting, not who is at the window', async ({ page }) => {
  await queue(page);
  await expect(page.locator('#queuecnt')).toHaveText('(3)');
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); });
  await expect(page.locator('#queuecnt')).toHaveText('(2)');
});

/* ---- the row states wear the app's colour code ---- */
test('waiting, at the window, flagged and served each read differently', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); queueServe('f2'); });
  const seen = await page.evaluate(() => {
    const g = sel => { const e = document.querySelector(sel); if (!e) return null;
      const cs = getComputedStyle(e); return { border: cs.borderTopColor, style: cs.borderTopStyle }; };
    return { win: g('.dayacc.qserving'), flag: g('.dayacc.qflag'), done: g('.dayacc.qdone') };
  });
  expect(seen.win.border).toBe('rgb(176, 96, 0)');    // amber: the clock is running
  expect(seen.flag.border).toBe('rgb(164, 38, 44)');  // red: somebody is needed
  expect(seen.done.style).toBe('dashed');             // quiet, without fading the words
});

test('a served row does not fade its own labels out of contrast', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); queueServe('f1'); });
  // it used to be opacity:.7, which took the small labels to 2.68:1 against
  // the card - under the 4.5:1 an AA reading needs
  const op = await page.locator('#queuebody .dayacc.qdone')
    .evaluate(el => getComputedStyle(el).opacity);
  expect(op).toBe('1');
});

test('the queue colours survive the dark theme', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    queueCall('f1'); queueViewClose();
  });
  const c = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ['--qwin', '--qwinink', '--qflag', '--qdoneink']
      .map(k => cs.getPropertyValue(k).trim());
  });
  // the light inks measured 2.3-3.3:1 on the dark card; these are the ones
  // that hold up there
  expect(c).toEqual(['#C97A1E', '#E8C260', '#E4756F', '#6FCB9B']);
});

test('nothing on the queue says its state in colour alone', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); queueServe('f2'); });
  await expect(page.locator('.dayacc.qserving .dbconf')).toContainText('At the window');
  await expect(page.locator('.dayacc.qdone .dbconf')).toContainText('Served at');
  await expect(page.locator('.dayacc.qflag .qseal')).toContainText('SEAL');
});

/* Every assertion above passed while this was broken: on a phone the status
   text and two buttons would not fit one line, so "Back to line" wrapped up
   to the right reading as the main action and "Mark served" dropped beneath
   it. Only looking at it showed that. */
test('on a phone the form actions sit on one row, primary on the right', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await queue(page);
  await page.evaluate(() => queueCall('f1'));
  const strip = page.locator('#fqview_body .qact');
  await expect(strip).toBeVisible();
  const back = await strip.locator('.qserve.ghost').boundingBox();
  const serve = await strip.locator('.qserve:not(.ghost)').boundingBox();
  expect(Math.abs(back.y - serve.y), 'the two actions share a row').toBeLessThan(2);
  expect(serve.x, 'Mark served keeps the right-hand side').toBeGreaterThan(back.x);
  // and the strip must not push the form off the top of a phone
  const box = await strip.boundingBox();
  expect(box.height).toBeLessThan(130);
});

/* ---- one control per row, and it looks like one ----
   The body of a row was a <button> wrapping the carrier, the driver, the PO
   and the trailer, sitting beside a second button. Every part was clickable,
   none of it looked clickable, and there was no way to tell what the row did
   as against what the button did. */
test('the row body is not itself one giant button', async ({ page }) => {
  await queue(page);
  await expect(page.locator('#queuebody .dbmain')).toHaveCount(3);
  // none of the row bodies is a control any more
  const tags = await page.locator('#queuebody .dbmain').evaluateAll(
    els => els.map(e => e.tagName));
  expect(tags).toEqual(['DIV', 'DIV', 'DIV']);
});

test('nothing on a row is a control except its buttons', async ({ page }) => {
  await queue(page);
  const row = rows(page).first();
  // no stretched hit areas, no clickable body - if it takes a click you can
  // see it
  await expect(row.locator('.qopen')).toHaveCount(0);
  const controls = await row.locator('button, a, [onclick], [tabindex]').count();
  expect(controls, 'a waiting row has exactly one control').toBe(1);
  await expect(row.locator('.qserve')).toHaveText('Serve');
});

test('a finished driver can still have their form opened', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); queueServe('f1'); });
  const done = page.locator('#queuebody .dayacc.qdone');
  await done.locator('.qserve.ghost').click();
  await expect(page.locator('#fqview')).toBeVisible();
  await expect(page.locator('#fqview_title')).toContainText('GH');
});

test('the figures are text again, not swallowed by a button label', async ({ page }) => {
  await queue(page);
  const row = page.locator('#queuebody .dayacc').first();
  // the old aria-label became the whole row's accessible name, so the driver,
  // the PO and the trailer were never announced at all
  await expect(row.locator('.dbsum')).toContainText('Kofi Gilbert');
  await expect(row.locator('.dbsum')).toContainText('8054736');
  const inButton = await row.locator('.dbsum').evaluate(el => !!el.closest('button'));
  expect(inButton, 'the figures must not sit inside a control').toBe(false);
});

test('the buttons on a row never overlap each other', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => { queueCall('f1'); queueViewClose(); });
  const row = page.locator('#queuebody .dayacc.qserving');
  const open  = await row.locator('.qserve.ghost').boundingBox();
  const serve = await row.locator('.qserve:not(.ghost)').boundingBox();
  expect(open.x + open.width, 'Open must end before Mark served begins')
    .toBeLessThanOrEqual(serve.x + 1);
});

test('clicking the body of a row does nothing at all', async ({ page }) => {
  await queue(page);
  const row = page.locator('#queuebody .dayacc').first();
  // the body used to be a control with its hit area stretched across the row,
  // so a click anywhere on it opened the form and there was no way to know
  // that from looking. It is text now.
  const box = await row.locator('.dbmain').boundingBox();
  for (const frac of [0.1, 0.5, 0.9]) {
    await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
    await expect(page.locator('#fqview')).toBeHidden();
  }
  const state = await page.evaluate(() => ({ at: queueServing().length, done: queueServed().length }));
  expect(state).toEqual({ at: 0, done: 0 });
  // and the numeral column is not a control either
  await row.locator('.qpos').click();
  await expect(page.locator('#fqview')).toBeHidden();
});

/* ---- serving a driver is two taps, and neither of them is Back ----
   It used to be three: call, mark served, then back out of a sheet that just
   sat there. That third tap is what made an explicit finish feel like
   ceremony, and it is the reason for wanting Back to do the finishing. */
test('serving a driver takes two taps, start to finish', async ({ page }) => {
  await queue(page);
  await rows(page).first().locator('.qserve').click();          // 1. Call next
  await expect(page.locator('#fqview')).toBeVisible();
  await page.locator('#fqview_body .qserve:not(.ghost)').click(); // 2. Mark served
  // the sheet closes itself: the job is done, there is nothing left to read
  await expect(page.locator('#fqview')).toBeHidden();
  await expect(page.locator('#queuebody .dayacc.qdone')).toContainText('GH');
});

test('backing out of a form serves nobody', async ({ page }) => {
  await queue(page);
  // a driver turned away on a broken seal, a form opened to print, an iPad
  // edge-swipe - all of these are "coming out of the tab", and none of them
  // means the driver was served. servedAt and servedBy are a record of who
  // dealt with whom; one written by a back gesture cannot be trusted.
  await page.evaluate(() => queueCall('f3'));
  await expect(page.locator('#fqview')).toBeVisible();
  await page.locator('#fqview .dvback').click();
  await expect(page.locator('#fqview')).toBeHidden();
  const after = await page.evaluate(() => ({
    served: queueServed().length, at: queueServing().map(f => f.carrier) }));
  expect(after.served).toBe(0);
  expect(after.at).toEqual(['SWIFT']);   // still at the window, still unserved
});

test('a driver can be turned away without ever being recorded as served', async ({ page }) => {
  await queue(page);
  await page.evaluate(() => queueCall('f3'));
  await page.locator('#fqview_body .qserve.ghost').click();   // Back to line
  const after = await page.evaluate(() => ({
    served: queueServed().length,
    waiting: queueWaiting().map(f => f.carrier),
    wroteServed: (window.__fb.updated || []).some(u => 'served' in u.data),
  }));
  expect(after.served).toBe(0);
  expect(after.waiting).toContain('SWIFT');
  expect(after.wroteServed, 'nothing should have written a served field').toBe(false);
});

/* ---- the filed sheet fits the screen it is on ----
   It is a fixed 1275x1650 drawing that only ever answered to width: on a
   1440x900 laptop that was 540px of empty space either side AND a third of the
   form below the fold. Two things have to hold at every size - it is never
   distorted, and the page never scrolls sideways. */
for (const [name, w, h] of [
  ['a phone',            390, 844],
  ['a phone on its side',844, 390],
  ['a tablet',           820, 1180],
  ['a laptop',          1440, 900],
  ['a wide monitor',    1920, 1080],
  ['a short window',    1280, 700],
  ['a very large screen',2560, 1440],
]) {
  test(`the seal form fits ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await queue(page);
    await page.evaluate(() => queueCall('f1'));
    await expect(page.locator('#fqview .ycpaper img')).toBeVisible();
    const m = await page.evaluate(() => {
      const img = document.querySelector('#fqview .ycpaper img');
      const box = document.querySelector('#fqview .ycpaper');
      const i = img.getBoundingClientRect();
      return { ratio: i.width / i.height, width: i.width,
               sideways: box.scrollWidth > box.clientWidth + 2
                      || document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    // only the width is set in CSS, so height:auto keeps the ratio true - a
    // max-height alongside it squashed the drawing to 3:1 on a landscape phone
    expect(Math.abs(m.ratio - 1275 / 1650), 'the sheet must never be distorted')
      .toBeLessThan(0.01);
    expect(m.sideways, 'nothing may scroll sideways').toBe(false);
    // and it must never shrink to a stamp: below the floor it scrolls instead
    expect(m.width).toBeGreaterThanOrEqual(Math.min(w - 40, 680) - 1);
  });
}

test('a big screen is actually used, not capped at 900', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await queue(page);
  await page.evaluate(() => queueCall('f1'));
  const wpx = await page.locator('#fqview .ycpaper img')
    .evaluate(el => el.getBoundingClientRect().width);
  expect(wpx, 'the old max-width:900px left large screens half empty')
    .toBeGreaterThan(900);
});
