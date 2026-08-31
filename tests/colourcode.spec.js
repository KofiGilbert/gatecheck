/* The colour code, and the two states the office board never had.

   Green means done, amber means the clock is running, red means somebody is
   late, purple means the office has not sent the list, grey means nothing is
   being asked of you yet. Five colours across both boards, and never colour
   on its own - the word on top and the glyph in the band carry the same
   information, which is what keeps the board readable for the roughly one man
   in twelve with a red-green deficiency. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const RGB = {
  done:  'rgb(30, 123, 79)',
  esc:   'rgb(30, 123, 79)',
  escBand:'rgb(61, 17, 19)',
  ready: 'rgb(176, 96, 0)',
  over:  'rgb(164, 38, 44)',
  due:   'rgb(126, 87, 194)',
  quiet: 'rgb(95, 107, 120)',
};

async function office(page) {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookreceiving@martin-brower.com'}, role:'office' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
}

/* put a released list on a slot, loaded `agoMin` minutes ago */
async function release(page, agoMin) {
  return page.evaluate((ago) => {
    const slot = YC_SHIFT_AM[0];
    DB.yardslots = [{ date: ycTodayISO(), slot,
      loadedAt: new Date(Date.now() - ago * 60000).toISOString(), count: 4 }];
    ycSlotsPersist(); go('block'); blockRender();
    return slot;
  }, agoMin);
}
const tileFor = (page, slot) =>
  page.locator('#bk_am .slot, #bk_pm .slot').nth(0);

test('a released list inside the hour is amber and counts down', async ({ page }) => {
  await office(page);
  await release(page, 10);
  const t = tileFor(page);
  await expect(t).toHaveClass(/ready/);
  await expect(t.locator('.top')).toHaveText('Released');
  expect(await t.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(RGB.ready);
});

test('once the hour is gone the office finally sees it is late', async ({ page }) => {
  await office(page);
  // before this, a list released at 06:00 and never walked still read
  // "Released" at ten at night: blockTile never looked at the clock at all
  await release(page, 75);
  const t = tileFor(page);
  await expect(t).toHaveClass(/over/);
  await expect(t.locator('.top')).toHaveText('Overdue');
  await expect(t.locator('.kpi')).toContainText('min');
  await expect(t.locator('.kpi')).toContainText('+');
  expect(await t.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(RGB.over);
});

test('late is the same hour the officer is held to', async ({ page }) => {
  await office(page);
  // one clock, one meaning: YC_WINDOW_MIN from the moment the list went out,
  // not from the hour printed on the tile
  expect(await page.evaluate(() => YC_WINDOW_MIN)).toBe(60);
  await release(page, 59);
  await expect(tileFor(page)).toHaveClass(/ready/);
  await release(page, 61);
  await expect(tileFor(page)).toHaveClass(/over/);
});

test('an hour that went by empty is not the same grey as one still to come', async ({ page }) => {
  await office(page);
  const seen = await page.evaluate(() => {
    DB.yardslots = []; go('block'); blockRender();
    const cls = s => blockTileState(s).cls;
    // within the shift being worked - an earlier shift's misses go quiet
    const closed = ycShiftSlots().filter(ycSlotWindowClosed);
    const open = YC_SHIFT_AM.concat(YC_SHIFT_PM)
      .filter(s => !ycSlotWindowClosed(s) && s !== blockNext());
    return { closed: closed.map(cls), open: open.map(cls) };
  });
  // both used to be 'past', both said "Not loaded" - the office's own missed
  // hour painted in the resting colour
  for (const c of seen.closed) expect(c).toBe('miss');
  for (const c of seen.open) expect(c).toBe('past');
});

test('a shift that has handed over stops shouting about its misses', async ({ page }) => {
  await office(page);
  const seen = await page.evaluate(() => {
    DB.yardslots = []; go('block'); blockRender();
    const mine = ycShiftSlots();
    const other = YC_SHIFT_AM.concat(YC_SHIFT_PM).filter(s => mine.indexOf(s) < 0);
    return other.filter(ycSlotWindowClosed).map(s => blockTileState(s).cls);
  });
  // three red tiles for 00, 02 and 04 sat on the board all afternoon; a board
  // that is permanently part red is a board where red stops meaning anything
  for (const c of seen) expect(c).toBe('past');
});

test('only one tile on the whole board is allowed to move', async ({ page }) => {
  await office(page);
  await page.evaluate(() => {
    const t = ycTodayISO();
    DB.yardslots = YC_SHIFT_AM.map(slot => ({ date: t, slot,
      loadedAt: new Date(Date.now() - 90 * 60000).toISOString(), count: 3 }));
    ycSlotsPersist(); go('block'); blockRender();
  });
  // six overdue slots, one pulse: a board where six things pulse is a board
  // nobody looks at
  await expect(page.locator('#bk_am .slot.over, #bk_pm .slot.over')).toHaveCount(6);
  await expect(page.locator('#bkboard .slot.alarm')).toHaveCount(1);
});

test('overdue outranks a clock that is still running', async ({ page }) => {
  await office(page);
  await page.evaluate(() => {
    const t = ycTodayISO(), mk = (slot, ago) => ({ date: t, slot,
      loadedAt: new Date(Date.now() - ago * 60000).toISOString(), count: 3 });
    DB.yardslots = [mk(YC_SHIFT_AM[0], 90), mk(YC_SHIFT_AM[1], 5)];
    ycSlotsPersist(); go('block'); blockRender();
  });
  await expect(page.locator('#bkboard .slot.alarm')).toHaveCount(1);
  await expect(page.locator('#bkboard .slot.alarm')).toHaveClass(/over/);
});

test('every state says which it is in words, not only in colour', async ({ page }) => {
  await office(page);
  await page.evaluate(() => { DB.yardslots = []; go('block'); blockRender(); });
  const tiles = page.locator('#bk_am .slot, #bk_pm .slot');
  const n = await tiles.count();
  for (let i = 0; i < n; i++) {
    await expect(tiles.nth(i).locator('.top')).not.toHaveText('');
    await expect(tiles.nth(i).locator('.arw')).not.toHaveText('');
  }
});

test('the key shows the band, so two green states are not one green chip', async ({ page }) => {
  await office(page);
  await page.evaluate(() => go('block'));
  const done = await page.locator('#bk_key .lg.done i')
    .evaluate(el => getComputedStyle(el).backgroundImage);
  const esc = await page.locator('#bk_key .lg.esc i')
    .evaluate(el => getComputedStyle(el).backgroundImage);
  expect(done).not.toBe(esc);
  expect(esc).toContain('61, 17, 19');
});

/* ---- the officer's board reads the same code ---- */
test('the officer and the office agree on what the colours mean', async ({ page }) => {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'mbmccookofficer@martin-brower.com'}, role:'officer' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'officer');
  const fills = await page.evaluate(() => {
    go('yard');
    const out = {};
    ['done','esc','ready','over','due','next','wait','past'].forEach(c => {
      const b = document.createElement('button');
      b.className = 'slot ' + c; document.body.appendChild(b);
      out[c] = getComputedStyle(b).backgroundColor; b.remove();
    });
    return out;
  });
  expect(fills.done).toBe(RGB.done);
  expect(fills.esc).toBe(RGB.esc);
  expect(fills.ready).toBe(RGB.ready);
  expect(fills.over).toBe(RGB.over);
  expect(fills.due).toBe(RGB.due);
  // the three quiet states are one grey; their words tell them apart
  expect(fills.next).toBe(RGB.quiet);
  expect(fills.wait).toBe(RGB.quiet);
  expect(fills.past).toBe(RGB.quiet);
});

test('nothing moves for someone who asked for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await office(page);
  await release(page, 90);
  const anim = await page.locator('#bkboard .slot.alarm')
    .evaluate(el => getComputedStyle(el).animationName);
  expect(anim).toBe('none');
});

/* The empty board was the only thing the wrap test ever saw, so the words that
   only appear on a busy board - "no list", "+40 min", "13 of 24" - were
   never measured in a card. One of them clipped on a phone at the largest
   text size. */
test('no label on a busy board wraps or clips out of its card', async ({ page }) => {
  await office(page);
  for (const size of ['normal', 'large', 'larger']) {
    for (const [w, h] of [[390, 844], [820, 1180], [1440, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((s) => {
        PREFS.size = s; prefsSave();
        const t = ycTodayISO(), N = Date.now();
        const mk = (slot, ago) => ({ date: t, slot,
          loadedAt: new Date(N - ago * 60000).toISOString(), count: 12 });
        // every state at once: released, overdue by a long way, completed
        // clean, completed with a two-digit escalation count, missed, and the
        // quiet ones
        DB.yardslots = [mk(YC_SHIFT_AM[1], 5), mk(YC_SHIFT_AM[2], 185),
                        mk(YC_SHIFT_AM[3], 30), mk(YC_SHIFT_AM[4], 30)];
        const rows = n => Array.from({ length: 24 }, (_, i) => ({ escalate: i < n ? ['TEMP'] : [] }));
        DB.yardchecks = [
          { date: t, time: YC_SHIFT_AM[3], name: 'Kobe', ts: new Date().toISOString(), rows: rows(0) },
          { date: t, time: YC_SHIFT_AM[4], name: 'Kobe', ts: new Date().toISOString(), rows: rows(13) },
        ];
        ycSlotsPersist(); ycPersistAll(); go('block'); blockRender();
      }, size);
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('#bk_am .slot, #bk_pm .slot').forEach(t => {
          const r = t.getBoundingClientRect();
          t.querySelectorAll('.top, .kpi').forEach(el => {
            const b = el.getBoundingClientRect();
            if (el.scrollWidth > el.clientWidth + 1)
              out.push('clipped "' + el.textContent.trim() + '"');
            if (b.bottom > r.bottom + 1 || b.right > r.right + 1)
              out.push('spilled "' + el.textContent.trim() + '"');
          });
        });
        return [...new Set(out)];
      });
      expect(bad, `${size} at ${w}x${h}`).toEqual([]);
    }
  }
});
