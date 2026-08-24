const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const REPO = path.resolve(__dirname, '..');

module.exports = defineConfig({
  testDir: __dirname,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8899',
    trace: 'retain-on-failure',
    /* The app installs a service worker on load. In a test that means the
       SECOND page.goto() of a test is answered by the worker rather than the
       app, and on WebKit it never settled at all - 24 tests timing out on
       nothing. Tests measure the app; the worker has its own tests. */
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium-mobile',  use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone',    use: { ...devices['iPhone 14'] } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    /* devserver.py, not http.server: the plain one lets the browser cache
       js/*.js, so an edit can sit on disk while the tests run yesterday's code */
    command: 'python3 devserver.py 8899',
    cwd: REPO,
    url: 'http://127.0.0.1:8899/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
