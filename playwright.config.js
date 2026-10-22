import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // The site starts with a ~3 second loader and the first page load compiles the app, so allow more than 30s.
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /demo\.spec/,
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      testIgnore: /demo\.spec/,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
      },
    },
    {
      // The developer demo screens only exist on a dev server started with VITE_ENABLE_DEMO_PERSONAS=true
      // (second server below). Everything else runs against the normal server, where they must be absent.
      name: 'demo-enabled',
      testMatch: /demo\.spec/,
      use: {
        baseURL: 'http://localhost:5174',
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { VITE_ENABLE_DEMO_PERSONAS: 'true' },
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
