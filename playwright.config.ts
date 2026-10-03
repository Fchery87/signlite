import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'node scripts/serve-production.mjs',
    port: 4173,
    timeout: 30000,
    reuseExistingServer: !process.env.CI
  }
});
