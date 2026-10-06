import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // The editor keeps the page, the library, and the batch list side by side
    // only at the xl breakpoint. Below that the side panels cover the page.
    viewport: { width: 1440, height: 900 }
  },
  webServer: {
    command: 'node scripts/serve-production.mjs',
    port: 4173,
    timeout: 30000,
    reuseExistingServer: !process.env.CI
  }
});
