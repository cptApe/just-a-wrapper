// Signs a person in through the real email-code flow; the keyless test env stores the code in Postgres.
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { auth } from '@/lib/auth';

export type SignedIn = { headers: Headers; userId: string; sessionId: string };

/** Signs up or in with the email code and returns the session cookie as request headers. */
export async function signInWithEmailCode(email: string): Promise<SignedIn> {
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  const { rows } = await db.execute<{ value: string }>(
    sql`select value from verification where identifier = ${`sign-in-otp-${email}`} order by created_at desc limit 1`,
  );
  const otp = rows.at(0)?.value.split(':').at(0);
  if (!otp) throw new Error(`No sign-in code was stored for ${email}`);
  const signedIn = await auth.api.signInEmailOTP({ body: { email, otp }, returnHeaders: true });
  const headers = new Headers({
    cookie: signedIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  });
  const viewer = await auth.api.getSession({ headers });
  if (!viewer) throw new Error(`Signing in ${email} created no session`);
  return { headers, userId: viewer.user.id, sessionId: viewer.session.id };
}
