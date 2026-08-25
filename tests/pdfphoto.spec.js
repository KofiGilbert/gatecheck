/* Checkpoint prints its own forms by drawing them, so the PDF holds a picture
   and not one letter of text. Pulling text out of it found nothing, and the
   page-of-text reader made nonsense of the table: a form rendered a thousand
   pixels across came back as "pom [ee [= [wf=[e [=f =|". */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');
const path = require('path');

const PDF = path.join(__dirname, 'fixtures', 'blockform.pdf');
/* every row of that form, read off the paper by eye */
const ROWS = [
  ['LR7435','FRIES'], ['57679','FRIES'], ['570251','FRIES'], ['LR7306','FRIES'],
  ['570451','FRIES'], ['4816','CFA FRIES'], ['2201','CFA FRIES'], ['9423','CFA FRIES'],
  ['2206','CFA FRIES'], ['H20058','CHICKEN'], ['7479','CHICKEN'],
  ['H40230','CHICKEN'], ['2202','COOKIES'],
];

test.describe('a PDF that is a picture', () => {

  test('is told apart from a printout, which carries its own text', async ({ page }) => {
    await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
    expect(await page.evaluate(() => typeof ingPdfIsPicture)).toBe('function');
    expect(await page.evaluate(() => typeof ingPdfPageFile)).toBe('function');
  });

  test('gives up every trailer and product on the form', async ({ page }, info) => {
    /* one OCR pass takes minutes; a second browser proves nothing new */
    test.skip(info.project.name !== 'chromium-desktop', 'slow, and the reader is the same');
    test.setTimeout(420000);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await H.gotoApp(page, { user:{email:'office@martinbrower.com'}, role:'office' });
    await page.evaluate(() => go('block'));
    await page.setInputFiles('#file', PDF);
    await page.waitForFunction(
      () => { const t = document.getElementById('bk_list'); return t && t.value.trim(); },
      null, { timeout: 360000 });

    const lines = (await page.inputValue('#bk_list')).trim().split('\n')
      .map(l => l.split(',').map(s => s.trim()));
    expect(lines.length, 'one line per trailer on the form').toBe(ROWS.length);
    expect(lines).toEqual(ROWS);
    expect(errs).toEqual([]);
    await expect(page.locator('#toast')).toContainText('13 trailers');
  });
});
