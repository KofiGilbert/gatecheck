const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

/* The officer should not write this out at the end of a shift. The app watched
   the shift, so it drafts each hour from the yard checks and the gate log; the
   officer reads it, fixes what it got wrong, and sends it. */

const asOfficer = (p) => H.gotoApp(p, { user:{email:'kofi@martinbrower.com'}, role:'officer' });

/* one shift's worth of record, pinned so the lines are predictable */
async function seed(page, opts) {
  return await page.evaluate((o) => {
    sset('gc_offname_kofi@martinbrower.com', 'Kobe');
    sset('gc_location', 'Martin Brower');
    sset('gc_manager', 'manager@npg.com');
    const cur = darCurrent();
    const hh = (h) => String(((h % 24) + 24) % 24).padStart(2, '0');
    DB.yardchecks = (o.checks || []).map(c => ({
      date: cur.date, time: hh(cur.start + c.at) + '00', name:'Kobe',
      ts: new Date().toISOString(),
      rows: Array.from({length: c.esc || 0}, () => ({ trailer:'X', escalate:['LOW FUEL'] }))
              .concat([{ trailer:'Y', escalate: [] }]),
    }));
    DB.logs = [];
    (o.logs || []).forEach((l, i) => {
      for (let k = 0; k < (l.in || 0); k++)
        DB.logs.push({ date: cur.date, po:'i'+i+k, timein: hh(cur.start + l.at) + '1' + k, timeout:'' });
      for (let k = 0; k < (l.out || 0); k++)
        DB.logs.push({ date: cur.date, po:'o'+i+k, timein:'0100', timeout: hh(cur.start + l.at) + '4' + k });
    });
    darBuild();
    go('dar');
    return { start: cur.start, date: cur.date };
  }, opts);
}
/* the shift is treated as over, so Submit and Edit are reachable in a test */
const ended = (page) => page.evaluate(() => { darOver = function(){ return true; }; renderDar(); });
const lines = async (page) => {
  await page.evaluate(() => { if(DAR.mode !== 'edit') darMode('edit'); });
  return page.locator('#darbody textarea').evaluateAll(els => els.map(e => e.value));
};
const paperLines = (page) => page.locator('.dpt tr td:nth-child(2)').allInnerTexts();

/* ---- the composed report ---- */

test('the shift is drafted hour by hour, from 6 to 6', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  const rows = page.locator('.dpt tr');
  await expect(rows).toHaveCount(14);                 // header + thirteen hours
  const t = await page.locator('.dpt td.t').allInnerTexts();
  expect(t.length).toBe(13);
  expect(t[0]).toMatch(/^(6am|6pm)$/);
  expect(t[12]).toMatch(/^(6pm|6am)$/);
});

test('the first hour reads as resuming the shift', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:0, esc:0 }], logs:[{ at:0, in:3, out:2 }] });
  const l = await lines(page);
  expect(l[0]).toBe('Officer Kobe resumes shift and conducts yard check with no escalations '
    + 'made. 3 trailers signed into the yard and 2 signed out.');
});

test('a yard check hour names how many escalated', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:2, esc:3 }] });
  const l = await lines(page);
  expect(l[2]).toBe('Officer Kobe conducts yard check, 3 escalations made. All Clear.');
});

test('an hour with only sign-ins says so', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { logs:[{ at:1, in:5, out:0 }] });
  const l = await lines(page);
  expect(l[1]).toBe('Officer Kobe continues signing trailers in and out of the yard. '
    + '5 trailers signed into the yard. All Clear.');
});

test('an hour with nothing on the record is All Clear', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  const l = await lines(page);
  expect(l[3]).toBe('All Clear.');
  expect(l[8]).toBe('All Clear.');
});

test('the last hour hands the shift over', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  await page.evaluate(() => darMode('edit'));
  await page.fill('#dar_hand', 'William');
  const l = await lines(page);
  expect(l[12]).toMatch(
    /^Officer Kobe completes (morning|evening) shift and hands over to Officer William\. All Clear\.$/);
});

/* ---- nothing is invented ---- */

test('a check that never happened is never claimed', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:0, esc:0 }] });
  const l = await lines(page);
  expect(l[0]).toContain('conducts yard check');
  for (let i = 1; i < 12; i++) expect(l[i]).not.toContain('conducts yard check');
});

/* ---- the officer's own words win ---- */

test('a line the officer rewrites is kept, and can be put back', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  await page.evaluate(() => darMode('edit'));
  const box = page.locator('#darbody textarea').nth(4);
  await box.fill('Gate held for a delivery van. All Clear.');
  await expect(page.locator('#darbody tr[data-i="4"]')).toHaveClass(/own/);

  // redrafting for the handover must not overwrite what the officer wrote
  await page.fill('#dar_hand', 'William');
  expect((await lines(page))[4]).toBe('Gate held for a delivery van. All Clear.');

  await page.locator('#darbody .darundo').click();
  expect((await lines(page))[4]).toBe('All Clear.');
  await expect(page.locator('#darbody tr[data-i="4"]')).not.toHaveClass(/own/);
});

/* ---- the header ---- */

test('the header carries the shift, the guard and the location', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  const paper = page.locator('.darpaper');
  await expect(paper).toContainText('Guard on Duty:');
  await expect(paper).toContainText('Kobe');
  await expect(paper).toContainText('Martin Brower');
  await expect(paper).toContainText(/6am – 6pm|6pm – 6am/);
  await expect(paper).toContainText('\u2019s Signature:');
});

test('Any Incident starts at No; an escalation is not an incident', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:1, esc:4 }] });      // four escalations, still No
  await expect(page.locator('.dpinc.ring')).toHaveText('No');
  expect(await page.evaluate(() => darData().incident)).toBe('No');
});

/* ---- sending ---- */

test('with no manager email the officer is sent to Settings', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  await page.evaluate(() => sset('gc_manager', ''));
  await ended(page);
  await page.click('#dar_submit');
  await expect(page.locator('#toast')).toContainText('manager email');
  await expect(page.locator('#sec-settings')).toBeVisible();
});

test('submitting files the report and names who wrote it', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:0, esc:1 }] });
  await page.evaluate(() => darMode('edit'));
  await page.fill('#dar_hand', 'William');
  await ended(page);
  page.once('dialog', d => d.accept());
  await page.click('#dar_submit');
  await expect.poll(() => page.evaluate(() => (DB.dars||[]).length)).toBe(1);
  const d = await page.evaluate(() => DB.dars[0]);
  expect(d.name).toBe('Kobe');
  expect(d.handover).toBe('William');
  expect(d.lines.length).toBe(13);
  expect(d.officer).toBe('kofi@martinbrower.com');
});

test('officers get the DAR; the office does not', async ({ page }) => {
  await asOfficer(page);
  await expect(page.locator('#sec-home .tile', { hasText:'DAR' })).toBeVisible();
  await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
  await page.goto('/index.html#dar');
  await expect(page.locator('#sec-dar')).toBeHidden();
});

test('the report opens as the sheet, with editing behind a button', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:2, esc:0 }] });
  // no boxes to type into until Edit is pressed
  await expect(page.locator('.darpaper')).toBeVisible();
  await expect(page.locator('#darbody textarea')).toHaveCount(0);
  await expect(page.locator('#darhead')).toBeHidden();

  await page.click('#dar_edit');
  await expect(page.locator('#darbody textarea')).toHaveCount(13);
  await expect(page.locator('#darhead')).toBeVisible();
  await expect(page.locator('.darpaper')).toHaveCount(0);

  await page.click('#dar_done');
  await expect(page.locator('.darpaper')).toBeVisible();
  await expect(page.locator('#darbody textarea')).toHaveCount(0);
});

test('an edit shows through on the sheet', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:2, esc:0 }] });
  await page.click('#dar_edit');
  await page.locator('#darbody textarea').nth(2).fill('Gate held for a visitor. All Clear.');
  await page.click('#dar_done');
  expect(await paperLines(page)).toContain('Gate held for a visitor. All Clear.');
});

test('Submit waits for the end of the shift', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  const btn = page.locator('#dar_submit');
  await page.evaluate(() => { darOver = function(){ return false; }; renderDar(); });
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveText('Submit to manager');       // the label is the label
  await expect(page.locator('#dar_why')).toContainText('when your shift ends');
  await ended(page);
  await expect(btn).toBeEnabled();
  await expect(page.locator('#dar_why')).toBeHidden();
});

test('Edit stays away until the app has written something', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});                       // nothing recorded yet
  await expect(page.locator('#dar_edit')).toBeHidden();
  await seed(page, { checks:[{ at:3, esc:0 }] });
  await expect(page.locator('#dar_edit')).toBeVisible();
});

test('the officer is told it fills itself, without being asked to do anything',
  async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:2, esc:0 }] });
  const note = page.locator('#dar_live');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Filling itself as you work');
  await expect(note).toHaveAttribute('role', 'status');   // told, not interrupted
  expect(await note.locator('button').count()).toBe(0);   // nothing to dismiss
  // it steps out of the way while the officer is editing
  await page.click('#dar_edit');
  await expect(note).toBeHidden();
});

test('Any Incident is switched on the sheet itself', async ({ page }) => {
  await asOfficer(page);
  await seed(page, {});
  await expect(page.locator('.dpinc.ring')).toHaveText('No');
  await page.locator('.dpinc', { hasText:'Yes' }).click();
  await expect(page.locator('.dpinc.ring')).toHaveText('Yes');
  expect(await page.evaluate(() => darData().incident)).toBe('Yes');
});

test('the report is still there after a refresh', async ({ page }) => {
  await asOfficer(page);
  await seed(page, { checks:[{ at:2, esc:1 }] });
  await expect(page.locator('.darpaper')).toBeVisible();
  await page.reload();
  await expect(page.locator('#sec-dar')).toBeVisible();
  await expect(page.locator('.darpaper')).toBeVisible();
  await expect(page.locator('.dpt tr')).toHaveCount(14);
  expect(await page.evaluate(() => location.hash)).toBe('#dar');
});
