/* The schedule arrives in whatever shape the sender had it in. These prove the
   office can load each of them without typing anything twice. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const H = require('./helpers.js');

const asOffice  = (page) => H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
const asOfficer = (page) => H.gotoApp(page, { user:{email:'kofi@martinbrower.com'},  role:'officer' });
const fixture   = (n) => path.join(__dirname, 'fixtures', n);

async function onSchedule(page){
  await asOffice(page);
  await page.evaluate(() => go('sched'));
  await expect(page.locator('#dz')).toBeVisible();
}

test('the office is told what it can send, before it sends it', async ({ page }) => {
  await onSchedule(page);
  await expect(page.locator('#dz')).toContainText('Drop a file here');
  await page.locator('#dzplus').click();
  const menu = page.locator('#dzmenu');
  await expect(menu).toBeVisible();
  for (const label of ['Spreadsheet', 'PDF', 'Word document', 'Photo', 'Paste rows'])
    await expect(menu).toContainText(label);
});

test('the menu closes on Escape and gives the button back the focus', async ({ page }) => {
  await onSchedule(page);
  await page.locator('#dzplus').click();
  await expect(page.locator('#dzmenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dzmenu')).toBeHidden();
  await expect(page.locator('#dzplus')).toBeFocused();
});

test('a Word document loads its table into the draft', async ({ page }) => {
  await onSchedule(page);
  await page.setInputFiles('#file', fixture('schedule.docx'));
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 15000 });
  // the grid is inputs, so the values are attributes, not page text
  await expect(page.locator('#draftgrid input[value="80123456"]')).toHaveCount(1);
  await expect(page.locator('#draftgrid input[value="LAMB WESTON"]')).toHaveCount(1);
  expect(await page.evaluate(() => SCHED_DRAFT.length)).toBe(3);
});

test('a PDF loads its rows into the draft, columns intact', async ({ page }) => {
  await onSchedule(page);
  await page.setInputFiles('#file', fixture('schedule.pdf'));
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 30000 });
  const rows = await page.evaluate(() => SCHED_DRAFT.map(r => [r.order, r.zone, r.carrier, r.cases]));
  expect(rows.length).toBe(3);
  expect(rows[0]).toEqual(['80123456', 'A', 'MW LOGISTICS', 1240]);
  expect(rows[2]).toEqual(['80123458', 'C', 'PETERSON FARMS', 2100]);
});

test('a PDF keeps the date it was printed with', async ({ page }) => {
  await onSchedule(page);
  await page.setInputFiles('#file', fixture('schedule.pdf'));
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 30000 });
  const dates = await page.evaluate(() => SCHED_DRAFT.map(r => r.date));
  expect(dates).toEqual(['2026-09-01', '2026-09-01', '2026-09-02']);
});

test('nothing reaches the yard until the office presses Submit', async ({ page }) => {
  await onSchedule(page);
  await page.setInputFiles('#file', fixture('schedule.docx'));
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => DB.orders.length), 'still a draft').toBe(0);
});

test('dropping a file on the schedule loads it', async ({ page }) => {
  await onSchedule(page);
  // a real DataTransfer, so this exercises the same drop handler a mouse would
  const buf = require('fs').readFileSync(fixture('schedule.docx')).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'schedule.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  }, buf);
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#draftgrid input[value="80123456"]')).toHaveCount(1);
});

test('dragging over the page marks the zone, and letting go clears it', async ({ page }) => {
  await onSchedule(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.locator('#dz')).toHaveClass(/over/);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.locator('#dz')).not.toHaveClass(/over/);
});

test('pasting rows copied out of Excel loads them', async ({ page }) => {
  await onSchedule(page);
  await page.evaluate(() => {
    const tsv = [
      'Date\tZone\tOrder Number\tVendor Name\tAppointment Carrier\tOpen Cases\tPallets',
      '2026-09-04\tD\t80900011\tKRAFT\tSUNSET TRANS\t500\t9',
      '2026-09-04\tE\t80900012\tCOCA COLA\tMW LOGISTICS\t640\t11'
    ].join('\n');
    const dt = new DataTransfer();
    dt.setData('text/plain', tsv);
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#draftgrid input[value="80900011"]')).toHaveCount(1);
});

test('a paste into the paste box is left alone', async ({ page }) => {
  await onSchedule(page);
  await page.locator('#dzplus').click();
  await page.locator('#dzmenu button', { hasText: 'Paste rows' }).click();
  await expect(page.locator('#pastebox')).toBeVisible();
  const handled = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'a\tb\nc\td\ne\tf');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.getElementById('paste').dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(handled, 'the textarea keeps its own paste').toBe(false);
});

test('a file Checkpoint cannot read says so, and says what to send', async ({ page }) => {
  await onSchedule(page);
  const msg = await page.evaluate(async () => {
    let said = '';
    const real = window.toast; window.toast = (m) => { said = m; };
    await ingestFile(new File(['x'], 'schedule.doc', { type: 'application/msword' }));
    window.toast = real;
    return said;
  });
  expect(msg).toContain('Save As');
  expect(msg).toMatch(/\.docx/);
});

test('an officer cannot load the schedule by dropping one', async ({ page }) => {
  await asOfficer(page);
  const msg = await page.evaluate(async () => {
    let said = '';
    const real = window.toast; window.toast = (m) => { said = m; };
    await ingestFiles([new File(['x'], 'schedule.xlsx')]);
    window.toast = real;
    return said;
  });
  expect(msg).toContain('receiving office');
});

test('the reader says which page it is on, then gets out of the way', async ({ page }) => {
  await onSchedule(page);
  const seen = [];
  await page.exposeFunction('__seen', (t) => seen.push(t));
  await page.evaluate(() => {
    const box = document.getElementById('dzprog');
    new MutationObserver(() => { if (!box.hidden) window.__seen(box.textContent); })
      .observe(box, { childList: true, subtree: true, attributes: true });
  });
  await page.setInputFiles('#file', fixture('schedule.pdf'));
  await expect(page.locator('#draftcard')).toBeVisible({ timeout: 30000 });
  expect(seen.some(t => /Reading page 1 of 1/.test(t)), seen.join(' | ')).toBe(true);
  await expect(page.locator('#dzprog')).toBeHidden();
});

test('the drop zone is readable in the dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await onSchedule(page);
  await page.locator('#dzplus').click();
  const bad = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const behind = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      }
      return 'rgb(255,255,255)';
    };
    const out = [];
    document.querySelectorAll('#dz *, #dz').forEach(el => {
      if (!el.childNodes.length) return;
      const txt = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
      if (!/[a-z0-9]/i.test(txt)) return;
      const a = lum(getComputedStyle(el).color), b = lum(behind(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5) out.push(txt.slice(0, 24) + ' ' + ratio.toFixed(1) + ':1');
    });
    return out;
  });
  expect(bad).toEqual([]);
});

test('one photo entry, because the phone already offers the camera inside it', async ({ page }) => {
  await onSchedule(page);
  await page.locator('#dzplus').click();
  const menu = page.locator('#dzmenu');
  await expect(menu.locator('button', { hasText: 'Photo' })).toHaveCount(1);
  await expect(menu).toContainText('Camera or library');
  // the old second entry, and the input that forced the camera, are both gone
  await expect(page.locator('#dzcam')).toHaveCount(0);
  await expect(page.locator('#filecam')).toHaveCount(0);
  await expect(menu).not.toContainText('Take a photo');
});

test('the photo entry accepts anything the camera or the library gives it', async ({ page }) => {
  await onSchedule(page);
  await page.locator('#dzplus').click();
  await page.locator('#dzmenu button', { hasText: 'Photo' }).click();
  await expect(page.locator('#file')).toHaveAttribute('accept', 'image/*');
});

test('a photograph taken with the camera goes to the photo reader', async ({ page }) => {
  await onSchedule(page);
  const went = await page.evaluate(async () => {
    let got = null;
    const real = window.importPhoto;
    window.importPhoto = (f) => { got = f.name; };
    await ingestFile(new File([new Uint8Array([1, 2, 3])], 'image.jpg', { type: 'image/jpeg' }));
    window.importPhoto = real;
    return got;
  });
  expect(went).toBe('image.jpg');
});
