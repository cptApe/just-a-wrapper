// The member token the MCP proxy trusts. The agent container sends the vault's
// static bearer; the proxy verifies it and calls Composio with its own key, never
// forwarding the bearer. The payload is `{ member_id, exp }`, where member_id is the
// member's composio_user_id, which is also the Composio user the proxy mints for.

import { jwtVerify, SignJWT } from 'jose';
import { IntegrationError } from '@/lib/errors';

const ALG = 'HS256';

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// `expiresIn` accepts jose's span syntax ('365d') or an absolute unix-seconds number.
export function signMemberToken(
  memberId: string,
  secret: string,
  expiresIn: string | number = '365d',
): Promise<string> {
  return new SignJWT({ member_id: memberId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey(secret));
}

// Throws jose's error on a bad signature or expiry. A token without `exp` would never
// expire, so it is refused; a verified token that names no member is unauthenticated.
export async function extractMemberId(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: [ALG],
    requiredClaims: ['exp'],
  });
  const memberId = payload.member_id;
  if (typeof memberId !== 'string' || memberId.length === 0) {
    throw new IntegrationError('UNAUTHENTICATED', 'jwt payload missing member_id', {
      reason: 'missing_member_id',
    });
  }
  return memberId;
}

// The trust boundary: every failure is one typed refusal the route maps to 401. The
// context carries a coarse reason, never the token.
export async function verifyMemberToken(token: string, secret: string): Promise<string> {
  if (!token) {
    throw new IntegrationError('WEBHOOK_SIGNATURE_INVALID', 'missing MCP-proxy JWT', {
      reason: 'absent',
    });
  }
  try {
    return await extractMemberId(token, secret);
  } catch (cause) {
    throw new IntegrationError(
      'WEBHOOK_SIGNATURE_INVALID',
      'MCP-proxy JWT verification failed',
      {},
      { cause },
    );
  }
}

// '' when the header is absent or not Bearer-shaped.
export function bearerFromHeader(header: string | null): string {
  if (!header) return '';
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match?.at(1)?.trim() ?? '';
}
