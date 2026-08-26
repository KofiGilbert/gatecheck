/* The gate log is a record of trucks through the gate, not a record of emails
   sent. logAdd sat inside emailData, so turning email off in the admin panel
   emptied the log without anyone touching the log. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function officer(page) {
  /* one handler for the whole test, not one per submit */
  page.on('dialog', d => d.accept());
  await H.gotoApp(page, { user:{email:'kobemensah007@proton.me'}, role:'officer' });
  await page.waitForFunction(() => window.CLOUD && CLOUD.user);
}
async function submit(page, po) {
  await page.evaluate((n) => {
    go('form');
    $('f_po').value = n;
    if ($('f_carrier')) $('f_carrier').value = 'J & L';
    if ($('f_trailer')) $('f_trailer').value = 'LR7524';
    if ($('f_timein')) $('f_timein').value = '0930';
  }, po);
  await page.evaluate(() => pushForm());
  await page.waitForTimeout(400);
}
const rows = (page) => page.evaluate(() => DB.logs.map(r => r.po));

test('a truck signed in lands on the gate log', async ({ page }) => {
  await officer(page);
  await submit(page, '8054516');
  expect(await rows(page)).toContain('8054516');
});

test('and still does with email switched off', async ({ page }) => {
  await officer(page);
  await page.evaluate(() => { var s = admSettings(); s.deliver.form.email = false; admSave(s); });
  await submit(page, '8054517');
  expect(await rows(page), 'the log emptied when email was turned off').toContain('8054517');
});

test('and with the app copy switched off instead', async ({ page }) => {
  await officer(page);
  await page.evaluate(() => { var s = admSettings(); s.deliver.form.app = false; admSave(s); });
  await submit(page, '8054518');
  expect(await rows(page)).toContain('8054518');
});

test('the row carries what the sheet asks for', async ({ page }) => {
  await officer(page);
  await submit(page, '8054519');
  const r = await page.evaluate(() => DB.logs[0]);
  expect(r.po).toBe('8054519');
  expect(r.carrier).toBe('J & L');
  expect(r.trailer).toBe('LR7524');
  expect(r.timein).toBe('0930');
  expect(r.timeout).toBe('');          // it has not left yet
  expect(r.date).toBe(await page.evaluate(() => isoToday()));
});

test('and it goes to the team, not just this phone', async ({ page }) => {
  await officer(page);
  await submit(page, '8054520');
  /* a log row is written under its own id, so it is a set rather than an add */
  const sent = await page.evaluate(() => (window.__fb.written||[]));
  expect(JSON.stringify(sent), 'the log row never left the device').toContain('8054520');
});

test('submitting the same truck twice does not double the sheet', async ({ page }) => {
  await officer(page);
  await submit(page, '8054521');
  await submit(page, '8054521');
  const n = (await rows(page)).filter(p => p === '8054521').length;
  expect(n).toBe(1);
});

test('the log shows it on the officer’s sheet', async ({ page }) => {
  await officer(page);
  await submit(page, '8054522');
  await page.evaluate(() => go('log'));
  /* the sheet has no order column - it carries the carrier and the trailer */
  await expect(page.locator('#sec-log')).toContainText('J & L');
  await expect(page.locator('#sec-log')).toContainText('LR7524');
});

/* Forms filed before the sheet was wired left no trace of themselves. They are
   still on file, so the sheet can be built from them rather than asking an
   officer to sign the same trucks in twice. */
const FORM = (po, over) => Object.assign({
  po: po, carrier:'J & L', trailer:'LR7524', tractor:'880', timein:'0930',
  datein: '', ts: new Date().toISOString() }, over || {});

test('this morning’s forms appear on today’s sheet', async ({ page }) => {
  await officer(page);
  await page.evaluate((fs) => {
    DB.forms = fs.map(f => Object.assign({}, f, { datein: todayStr() }));
    DB.logs = []; logPersist();
    go('log');
  }, [FORM('8054600'), FORM('8054601', { carrier:'GENEVA', timein:'1030' })]);
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => DB.logs.map(r => r.po).sort());
  expect(rows, 'the forms on file were not put on the sheet').toEqual(['8054600','8054601']);
  await expect(page.locator('#sec-log')).toContainText('GENEVA');
});

test('and are not added twice when the sheet is opened again', async ({ page }) => {
  await officer(page);
  await page.evaluate((f) => {
    DB.forms = [Object.assign({}, f, { datein: todayStr() })];
    DB.logs = []; logPersist(); go('log');
  }, FORM('8054602'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { go('home'); go('log'); });
  await page.waitForTimeout(200);
  expect((await page.evaluate(() => DB.logs.filter(r => r.po === '8054602'))).length).toBe(1);
});

test('yesterday’s forms are left where they belong', async ({ page }) => {
  await officer(page);
  await page.evaluate((f) => {
    DB.forms = [Object.assign({}, f, { datein: '8/1/26' })];
    DB.logs = []; logPersist(); go('log');
  }, FORM('8054603'));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => DB.logs.length)).toBe(0);
});

test('a backfilled row goes to the team as well', async ({ page }) => {
  await officer(page);
  await page.evaluate((f) => {
    DB.forms = [Object.assign({}, f, { datein: todayStr() })];
    DB.logs = []; logPersist(); go('log');
  }, FORM('8054604'));
  await page.waitForTimeout(300);
  expect(JSON.stringify(await page.evaluate(() => window.__fb.written || [])))
    .toContain('8054604');
});
