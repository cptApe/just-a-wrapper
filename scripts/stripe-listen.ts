import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Stripe webhook bridge for local dev. Two modes:
//   pnpm stripe:secret  — print the webhook signing secret (whsec_...) for this
//                         CLI+account pair and exit; paste it into the env file
//                         as STRIPE_WEBHOOK_SECRET. Stable for ~90 days.
//   pnpm stripe:listen  — forward live test-mode events to the local webhook
//                         route on this worktree's dev port.
// --api-key is passed explicitly so the CLI's interactive login (which may be
// a different Stripe account) is ignored entirely.

const apiKey = process.env.STRIPE_SECRET_KEY;
if (!apiKey) {
  console.error(
    'STRIPE_SECRET_KEY is not set in the env file. Add the test-mode sk_test_... key first.',
  );
  process.exit(1);
}
if (!apiKey.startsWith('sk_test_')) {
  console.error(
    'Refusing to run: STRIPE_SECRET_KEY is not a test-mode key (expected sk_test_...).',
  );
  process.exit(1);
}

const printSecretOnly = process.argv.includes('--print-secret');

const port = existsSync('.dev-port') ? readFileSync('.dev-port', 'utf8').trim() || '3000' : '3000';

const args = printSecretOnly
  ? ['listen', '--api-key', apiKey, '--print-secret']
  : ['listen', '--api-key', apiKey, '--forward-to', `localhost:${port}/api/webhooks/stripe`];

const child = spawn('stripe', args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
