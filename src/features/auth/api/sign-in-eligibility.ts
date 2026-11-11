'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { withRequestContext } from '@/lib/request-context';
import { emailInput } from '../lib/email-input';
import { createEmailRateLimit } from '../lib/email-rate-limit';
import type { SignInEligibility } from '../types';

const allowCheck = createEmailRateLimit();

export async function checkSignInEligibility(email: unknown): Promise<SignInEligibility> {
  return withRequestContext({ route: 'sign-in-eligibility' }, async () => {
    const parsed = emailInput.safeParse(email);
    if (!parsed.success) return { status: 'invalid' };
    if (env.AUTH_SIGNUPS_CLOSED !== 'true') return { status: 'eligible' };
    if (!allowCheck(parsed.data)) return { status: 'rate-limited' };

    try {
      const existing = (
        await db.select({ id: user.id }).from(user).where(eq(user.email, parsed.data)).limit(1)
      ).at(0);
      return existing ? { status: 'eligible' } : { status: 'no-account' };
    } catch (cause) {
      throw new AppError(
        'DATABASE_UNAVAILABLE',
        'Could not check sign-in eligibility.',
        {},
        { cause },
      );
    }
  });
}
