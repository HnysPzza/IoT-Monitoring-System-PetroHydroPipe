const { defineConfig, devices } = require('@playwright/test')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.cjs',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `${npm} run dev -- --host 127.0.0.1 --port 5175 --strictPort`,
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...process.env, VITE_USE_MOCK_LOGIN: 'true' },
  },
})
