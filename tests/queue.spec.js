/* The gate queue: every seal form, stood in the order the drivers signed in,
   so the office knows who to serve next. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

const F = (id, hoursAgo, o) => Object.assign({
  _id: id, ts: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
  carrier: 'MW LOGISTICS', driver: 'Ama', po: '8040001', trailer: 'LR7524',
  sealcond: 'INTACT',
}, o || {});

async function onQueue(page, forms) {
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.evaluate((f) => { DB.forms = f; go('queue'); }, forms);
}

test('the office has a Gate queue tile, and the tile counts the line', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
  const tile = page.locator('#sec-office .tile', { hasText: 'Gate queue' });
  await expect(tile).toHaveCount(1);
  await page.evaluate(() => {
    DB.forms = [ { _id:'a', ts:new Date().toISOString(), carrier:'X', sealcond:'INTACT' },
                 { _id:'b', ts:new Date().toISOString(), carrier:'Y', sealcond:'INTACT' } ];
    officeStat();
  });
  await expect(page.locator('#qtile_sub')).toHaveText('2 drivers waiting');
  await tile.click();
  await expect(page.locator('#sec-queue')).toBeVisible();
});

test('the line stands in the order the drivers signed in', async ({ page }) => {
  await onQueue(page, [F('late', 1, { carrier:'CH ROBINSON' }),
                       F('first', 5, { carrier:'ROEHL' }),
                       F('mid', 3, { carrier:'MARTEN' })]);
  const names = await page.locator('.dayacc:not(.qdone) .dbdate').allInnerTexts();
  expect(names.map(n => n.trim().split(' ')[0])).toEqual(['ROEHL', 'MARTEN', 'CH']);
  // the head of the line is pointed at
  await expect(page.locator('#queuebody .dayacc').first()).toHaveClass(/qnext/);
  await expect(page.locator('#queuebody .dayacc').first()).toContainText('#1 · NEXT');
});

test('a broken or missing seal is flagged on the row', async ({ page }) => {
  await onQueue(page, [F('a', 2), F('b', 1, { sealcond:'BROKEN', carrier:'CH ROBINSON' })]);
  const flagged = page.locator('.dayacc.qflag');
  await expect(flagged).toHaveCount(1);
  await expect(flagged).toContainText('SEAL BROKEN');
});

test('serving moves the driver to the done pile, and records who served it', async ({ page }) => {
  await onQueue(page, [F('a', 2, { carrier:'ROEHL' }), F('b', 1, { carrier:'MARTEN' })]);
  await page.locator('#queuebody .dayacc').first().locator('.qserve').click();
  await expect(page.locator('.dayacc:not(.qdone)')).toHaveCount(1);
  await expect(page.locator('.dayacc.qdone')).toContainText('ROEHL');
  // only the serve fields go to the server: the form stays as it was filed
  const up = await page.evaluate(() => window.__fb.updated);
  expect(up).toHaveLength(1);
  expect(up[0].id).toBe('a');
  expect(Object.keys(up[0].data).sort()).toEqual(['served', 'servedAt', 'servedBy']);
  expect(up[0].data.servedBy).toBe('office@martinbrower.com');
});

test('the next driver steps up when the first is served', async ({ page }) => {
  await onQueue(page, [F('a', 2, { carrier:'ROEHL' }), F('b', 1, { carrier:'MARTEN' })]);
  await page.locator('#queuebody .dayacc').first().locator('.qserve').click();
  const head = page.locator('.dayacc:not(.qdone)').first();
  await expect(head).toHaveClass(/qnext/);
  await expect(head).toContainText('MARTEN');
  await expect(head).toContainText('#1 · NEXT');
});

test('a slip can be undone, and the driver rejoins the line in its old place', async ({ page }) => {
  await onQueue(page, [F('a', 3, { carrier:'ROEHL' }), F('b', 1, { carrier:'MARTEN' })]);
  await page.locator('#queuebody .dayacc').first().locator('.qserve').click();
  await page.locator('.dayacc.qdone .qserve.undo').click();
  const names = await page.locator('.dayacc:not(.qdone) .dbdate').allInnerTexts();
  expect(names[0]).toContain('ROEHL');
  await expect(page.locator('.dayacc.qdone')).toHaveCount(0);
});

test('a slip older than a day is not still standing at the head of the line', async ({ page }) => {
  await onQueue(page, [F('old', 30, { carrier:'STALE INC' }), F('a', 1)]);
  await expect(page.locator('#queuebody')).not.toContainText('STALE INC');
  await expect(page.locator('.dayacc:not(.qdone)')).toHaveCount(1);
});

test('an empty line says so, and says how it fills', async ({ page }) => {
  await onQueue(page, []);
  await expect(page.locator('.qempty')).toHaveText('Nobody waiting.');
});

test('tapping a driver opens their seal form, drawn as it was filed', async ({ page }) => {
  await onQueue(page, [F('a', 1, { carrier:'ROEHL' })]);
  await page.locator('#queuebody .dbmain').first().click();
  await expect(page.locator('#fqview')).toBeVisible();
  await expect(page.locator('#fqview .ycpaper img')).toBeVisible();
  await expect(page.locator('#fqview_title')).toContainText('ROEHL');
  await expect(page.locator('#fqview .bkprint')).toBeVisible();
  // a sub-route: refresh keeps it, back closes it
  expect(await page.evaluate(() => location.hash)).toBe('#queue/a');
  await page.click('#fqview .dvback');
  await expect(page.locator('#fqview')).toBeHidden();
  await expect(page.locator('#sec-queue')).toBeVisible();
});

test('a refresh keeps the office on the queue, form open and all', async ({ page }) => {
  // seeded through the stub, so the form is still there after the reload
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office',
    forms: [F('a', 1, { carrier:'ROEHL' })] });
  await page.evaluate(() => go('queue'));
  await page.locator('#queuebody .dbmain').first().click();
  await page.reload();
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'office');
  await page.waitForTimeout(400);
  await expect(page.locator('#sec-queue')).toBeVisible();
  await expect(page.locator('#fqview .ycpaper img')).toBeVisible({ timeout: 10000 });
});

test('a new form landing from the gate joins the line at once', async ({ page }) => {
  await onQueue(page, [F('a', 2, { carrier:'ROEHL' })]);
  await page.evaluate(() => {
    window.__fb.orders = window.__fb.orders || [];
    DB.forms.push({ _id:'fresh', ts:new Date().toISOString(), carrier:'FRESH TRANS', sealcond:'INTACT' });
    renderQueue(); queueTileSync();
  });
  await expect(page.locator('#queuebody')).toContainText('FRESH TRANS');
  await expect(page.locator('#qtile_sub')).toHaveText('2 drivers waiting');
});

test('officers do not get the queue', async ({ page }) => {
  await H.gotoApp(page, { user:{email:'kofi@martinbrower.com'}, role:'officer' });
  await page.evaluate(() => go('queue'));
  await expect(page.locator('#sec-queue')).toBeHidden();
  await expect(page.locator('#sec-home')).toBeVisible();
});

test('the queue is readable in the dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await onQueue(page, [F('a', 2), F('b', 1, { sealcond:'MISSING', carrier:'CH ROBINSON' }),
                       F('c', 3, { served:true, servedAt:new Date().toISOString() })]);
  const bad = await page.evaluate(() => {
    const lum = (c) => { const n=(c.match(/\d+/g)||[0,0,0]).map(Number);
      const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
      return 0.2126*f(n[0])+0.7152*f(n[1])+0.0722*f(n[2]); };
    const out = [];
    document.querySelectorAll('#sec-queue *').forEach(el => {
      const txt = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
      if(!/[a-z0-9]/i.test(txt)) return;
      let bg='rgba(0, 0, 0, 0)';
      for(let p=el;p&&bg==='rgba(0, 0, 0, 0)';p=p.parentElement) bg=getComputedStyle(p).backgroundColor;
      const a=lum(getComputedStyle(el).color), b=lum(bg);
      const r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
      if(r<4.5) out.push(txt.slice(0,20)+' '+r.toFixed(1)+':1');
    });
    return out;
  });
  expect(bad).toEqual([]);
});

test('four tiles sit on one line and fit the screen', async ({ page }) => {
  for (const [w, h] of [[1180, 820], [1366, 1024], [820, 1180]]) {
    await page.setViewportSize({ width: w, height: h });
    await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
    const m = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#sec-office .tile')];
      const rows = new Set(t.map(x => Math.round(x.getBoundingClientRect().top))).size;
      return { n: t.length, rows,
               scrolls: document.documentElement.scrollHeight > innerHeight + 2 };
    });
    expect(m.n).toBe(4);
    if (w > 760) expect(m.rows, `${w}x${h}: one line`).toBe(1);
    expect(m.scrolls, `${w}x${h}: everything on screen`).toBe(false);
  }
});

test('the queue wears the loaded-orders row, and carries no explainer', async ({ page }) => {
  await onQueue(page, [F('a', 1, { carrier:'ROEHL' })]);
  await expect(page.locator('#queuebody .daybar')).toHaveCount(1);
  await expect(page.locator('#queuebody .dbstat')).toHaveCount(3);
  const words = (await page.locator('#queuelist').innerText()).split(/\s+/).length;
  expect(words, 'a heading and the data, nothing describing the screen').toBeLessThan(30);
  await expect(page.locator('#sec-queue .hint')).toHaveCount(0);
});
