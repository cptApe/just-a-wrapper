/** The MCP proxy's sign-in: only a token we signed, still valid, naming a member, opens a member's
 * connected apps. A garbage token and a removed member are refused on Postgres in
 * tests/integration/mcp-proxy.test.ts. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { extractMemberId, signMemberToken } from '../../src/features/integrations/jwt.ts';

const SECRET = 'unit-test-secret-unit-test-secret-unit-test';
const OTHER = 'a-different-secret-a-different-secret-xxxxxx';
const key = new TextEncoder().encode(SECRET);

test('a token we signed opens only the member it names', async () => {
  const token = await signMemberToken('cu-abc', SECRET, '5m');
  assert.equal(await extractMemberId(token, SECRET), 'cu-abc');
});

test('a forged, altered, expired, never-expiring or memberless token is refused', async () => {
  const valid = await signMemberToken('cu-abc', SECRET, '5m');
  const past = Math.floor(Date.now() / 1000) - 3600;
  const refused = {
    'another secret': await signMemberToken('cu-abc', OTHER, '5m'),
    altered: `${valid.slice(0, -3)}xyz`,
    expired: await new SignJWT({ member_id: 'cu-abc' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(past)
      .setExpirationTime(past + 10)
      .sign(key),
    'no expiry': await new SignJWT({ member_id: 'cu-abc' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(key),
    'no member': await new SignJWT({ sub: 'no-member' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(key),
    empty: '',
  };
  for (const [label, token] of Object.entries(refused)) {
    await assert.rejects(extractMemberId(token, SECRET), Error, label);
  }
});
