import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  projects: [
    { name: 'desktop-chromium', testIgnore: '**/mobile-touch.spec.ts' },
    { name: 'touch-chromium', testMatch: '**/mobile-touch.spec.ts', use: { ...devices['Pixel 7'] } },
    { name: 'touch-webkit', testMatch: '**/mobile-touch.spec.ts', use: { ...devices['iPhone 13'] } }
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Dedicated touch projects exercise the mobile tool dialogs separately.
    viewport: { width: 1440, height: 900 }
  },
  webServer: {
    command: 'node scripts/serve-production.mjs',
    port: 4173,
    timeout: 30000,
    reuseExistingServer: !process.env.CI
  }
});
