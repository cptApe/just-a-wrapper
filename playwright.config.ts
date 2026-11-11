import { defineConfig, devices } from '@playwright/test';

// E2E smoke tests. Runs headless locally (`pnpm test:e2e`) and in CI. Playwright
// starts the Next dev server itself (webServer below) with placeholder env that
// only satisfies env.ts validation — these smoke tests hit the login page and an
// unauthenticated redirect, neither of which does real DB/Google work.
//
// Kept OUT of `pnpm verify` and the Stop hook (needs a browser + a running
// server — too slow for the fast gate). CI runs it as a separate job.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Placeholder values — satisfy env.ts schema validation only. The smoke
      // tests never exercise a real DB or Google OAuth round-trip.
      // CI points these at a throwaway Postgres with migrations applied; pages read deployment settings.
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://ci:ci@localhost:5432/ci',
      ...(process.env.E2E_WS_PROXY ? { DATABASE_WS_PROXY: process.env.E2E_WS_PROXY } : {}),
      BETTER_AUTH_SECRET: 'e2e_placeholder_secret_at_least_32_chars_long',
      GOOGLE_CLIENT_ID: 'e2e-placeholder',
      GOOGLE_CLIENT_SECRET: 'e2e-placeholder',
      NEXT_PUBLIC_APP_URL: BASE_URL,
    },
  },
});
