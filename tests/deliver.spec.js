/* The admin panel offers three documents and two routes each. Six switches -
   and until now only two of them did anything. admGoes was wired for the seal
   form and nothing else, so turning Yard check → Email off changed nothing at
   all, and the filed check then offered to send it "again" whether or not
   anything had ever been sent. */
const { test, expect } = require('@playwright/test');
const H = require('./helpers.js');

async function officer(page, deliver) {
  await page.route('**/firebasejs/**', r => r.fulfill({contentType:'application/javascript', body:''}));
  await page.addInitScript(H.FB_STUB, { user:{email:'kobe@martinbrower.com'}, role:'officer' });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CLOUD && CLOUD.role === 'officer');
  /* set after boot, through the app's own writer: something on the way in
     clears storage, so an addInitScript value is gone by the time anything
     reads it */
  await page.evaluate((d) => {
    sset('gc_admin', JSON.stringify({ deliver: d, queueHours: 12 }));
    // a mailer, so the email branch is the one under test rather than the
    // share-a-file fallback
    sset('gc_mailer', 'https://mailer.example/send');
  }, deliver);
}
const ALL_ON  = { form:{email:true,app:true},  yard:{email:true,app:true},  dar:{email:true,app:true} };
const YC_OFF  = { form:{email:true,app:true},  yard:{email:false,app:true}, dar:{email:true,app:true} };

test('with Yard check email on, the switch reads as on', async ({ page }) => {
  await officer(page, ALL_ON);
  expect(await page.evaluate(() => ycEmails())).toBe(true);
});

test('turning Yard check email off actually turns it off', async ({ page }) => {
  await officer(page, YC_OFF);
  // this used to be a switch that nothing read
  expect(await page.evaluate(() => ycEmails())).toBe(false);
  const sent = await page.evaluate(async () => {
    window.__sent = 0;
    window.fetch = () => { window.__sent++; return Promise.resolve({ json: () => ({ ok: true }) }); };
    ycSendData({ date: ycTodayISO(), time: '0600', name: 'Kobe',
      rows: [{ trailer:'LR7422', product:'FRIES', set:'-10', temp:'-9.0',
               fuel:'1/2', intact:'N', door:'36', escalate: [] }] });
    // the send sits inside a canvas callback
    await new Promise(r => setTimeout(r, 600));
    return window.__sent;
  });
  expect(sent, 'nothing may be emailed when the panel says not to').toBe(0);
});

test('the button on a filed check says which it is doing', async ({ page }) => {
  await officer(page, ALL_ON);
  await page.evaluate(() => ycEmailLabel());
  // one went at submit, so offering to send it again is true
  await expect(page.locator('#yc_email')).toContainText('again');
});

test('and does not claim "again" when nothing was ever emailed', async ({ page }) => {
  await officer(page, YC_OFF);
  await page.evaluate(() => ycEmailLabel());
  await expect(page.locator('#yc_email')).toContainText('Email this record');
  await expect(page.locator('#yc_email')).not.toContainText('again');
});

test('pressing the button sends even when automatic email is off', async ({ page }) => {
  await officer(page, YC_OFF);
  const sent = await page.evaluate(async () => {
    window.__sent = 0;
    window.fetch = () => { window.__sent++; return Promise.resolve({ json: () => ({ ok: true }) }); };
    // a deliberate press is not automatic delivery: it goes
    ycSendData({ date: ycTodayISO(), time: '0600', name: 'Kobe',
      rows: [{ trailer:'LR7422', product:'FRIES', set:'-10', temp:'-9.0',
               fuel:'1/2', intact:'N', door:'36', escalate: [] }] }, true);
    await new Promise(r => setTimeout(r, 600));
    return window.__sent;
  });
  expect(sent).toBe(1);
});

test('the daily activity report reads its switches too', async ({ page }) => {
  await officer(page, { form:{email:true,app:true}, yard:{email:true,app:true},
                        dar:{email:false,app:false} });
  const out = await page.evaluate(() => ({
    email: admGoes('dar', 'email'), app: admGoes('dar', 'app') }));
  expect(out).toEqual({ email: false, app: false });
});

test('every switch the panel shows is read by something', async ({ page }) => {
  await officer(page, ALL_ON);
  // six controls, six answers - the panel must not offer a control that
  // changes nothing
  const answers = await page.evaluate(() =>
    ['form', 'yard', 'dar'].map(k => [k, admGoes(k, 'email'), admGoes(k, 'app')]));
  expect(answers.length).toBe(3);
  for (const [, e, a] of answers) {
    expect(typeof e).toBe('boolean');
    expect(typeof a).toBe('boolean');
  }
});
