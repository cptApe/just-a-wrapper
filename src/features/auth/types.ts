export type AuthStep = 'email' | 'otp' | 'closed';

export type SignInEligibility = { status: 'eligible' | 'invalid' | 'no-account' | 'rate-limited' };
