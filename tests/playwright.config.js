const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const REPO = path.resolve(__dirname, '..');

module.exports = defineConfig({
  testDir: __dirname,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: 'http://127.0.0.1:8899', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-mobile',  use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone',    use: { ...devices['iPhone 14'] } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'python3 -m http.server 8899 --bind 127.0.0.1',
    cwd: REPO,
    url: 'http://127.0.0.1:8899/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
