import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Vitest runs the DB-INTEGRATION suite only (tests/integration/**). Pure unit
// tests stay on `node --test` (see package.json `test:unit`) — Node 22 strips
// types natively, so they need no bundler. Integration tests need a real
// Postgres reached through the Neon wsproxy; they are gated out of `pnpm verify`
// and the Stop hook (slow, require Docker) and run via `pnpm test:integration`.
export default defineConfig({
  resolve: {
    alias: {
      'next/server': path.resolve(__dirname, './tests/integration/helpers/next-server-stub.ts'),
      '@': path.resolve(__dirname, './src'),
      // Mirrors the tsconfig "@content/*" path (brand constants + content
      // files) so src modules that import it resolve under plain-node vitest.
      '@content': path.resolve(__dirname, './content'),
      // `server-only` is a Next-provided guard with no runtime behaviour; it isn't
      // resolvable under plain-node vitest, so stub it for server modules under test.
      'server-only': path.resolve(__dirname, './tests/integration/helpers/server-only-stub.ts'),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // The app's env.ts validates required vars at import time; provide test
    // values so importing src modules (schema, provisioning) doesn't throw.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://test:test@localhost:55432/agentcore_test',
      BETTER_AUTH_SECRET: 'test_secret_at_least_thirty_two_characters_long',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      NEXT_PUBLIC_ENABLE_DEV_ROUTES: 'false',
      // Billing (Stage 14a) — a dummy test-mode key is enough for offline
      // signature construction/verification (no network); the webhook secret is
      // shared with the test that signs its own payloads.
      STRIPE_SECRET_KEY: 'sk_test_dummy_for_offline_signature_tests',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_for_signature_tests',
      // The suite describes what wrapper.arnas.st runs. Subscription tests switch the mode
      // through the deployment settings store, as an admin would.
      BILLING_MODE: 'credits_only',
    },
    // Each integration file owns the shared DB; run files serially so they don't
    // truncate each other's rows mid-test.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
