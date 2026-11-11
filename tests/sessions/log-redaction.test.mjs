// Mirrored session events and logs never keep emails, tokens or keys.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitize, sanitizeString } from '../../src/lib/sanitize.ts';

test('emails, bearer tokens, JWTs, API keys and secret fields are redacted from a logged payload', () => {
  const toolUse = {
    name: 'send_email',
    input: { to: 'alice@example.com', body: 'Reach me at bob.smith@example.com.' },
    password: 'hunter2',
    nested: { token: 'abc', api_key: 'xyz' },
  };
  const json = JSON.stringify(sanitize(toolUse, { truncateAt: 512 }));
  for (const secret of ['alice@example.com', 'bob.smith@example.com', 'hunter2', '"abc"', '"xyz"'])
    assert.ok(!json.includes(secret), `${secret} leaked`);
  for (const [text, secret] of [
    ['Authorization: Bearer abcdef1234567890', 'abcdef1234567890'],
    ['key sk-ant-api03-abcdef123456789', 'sk-ant-api03'],
    ['eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT4', 'SflKxwRJSMeKKF2QT4'],
  ])
    assert.ok(!sanitizeString(text).includes(secret), text);
  assert.deepEqual(sanitize({ count: 3, ok: true, name: 'bash' }), {
    count: 3,
    ok: true,
    name: 'bash',
  });
});

test('a long body is cut after redaction, so a key crossing the cut is already gone', () => {
  const secret = 'sk-ant-api03-abcdef1234567890abcdef';
  const out = sanitize({ body: `${'x'.repeat(500)} ${secret}` }, { truncateAt: 512 });
  assert.ok(!out.body.includes('sk-ant-api03-abc'));
  assert.equal(
    sanitize({ body: 'x'.repeat(2000) }, { truncateAt: 512 }).body,
    `${'x'.repeat(512)}…[+1488 chars]`,
  );
});
