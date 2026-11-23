// Content-Security-Policy check against the production build (see tests/csp/csp.spec.js).
// Kept apart from playwright.config.js because the normal suite runs on the dev server,
// which uses inline scripts for hot reload that a production policy correctly blocks.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/csp',
  timeout: 120000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5175', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'npx vite preview --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
