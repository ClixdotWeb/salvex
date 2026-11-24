// REAL end-to-end checks: the website, the API and the LOCAL development database, nothing mocked.
// Needs `npm run dev:all` (or it is started here) and a local PostgreSQL. Never point this at production:
// tests/real/dbq.py refuses any non-local database. Run with: npx playwright test -c playwright.real.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/real',
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/real-results.json' }]],
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  // Always a fresh server started HERE with the developer outbox: never reuse one that may have real SMTP/SMS
  // settings from backend/.env (that would email the @example.com test accounts for real).
  webServer: {
    command: 'npm run dev:all', url: 'http://localhost:5173', reuseExistingServer: false, timeout: 180000,
    env: { EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console', MOBILE_OTP_REQUIRED: 'false' },
  },
});
