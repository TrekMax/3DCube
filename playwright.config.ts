import { defineConfig } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1100 },
    launchOptions: { args: ['--no-sandbox', '--enable-unsafe-swiftshader'] },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
