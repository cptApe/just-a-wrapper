const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_EMAILS = 10_000;

// Bound both retention and capacity: public actions must not retain arbitrary
// addresses indefinitely. Full capacity refuses new keys until a window expires.
export function createEmailRateLimit() {
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  return (email: string, now = Date.now()): boolean => {
    for (const [key, entry] of attempts) {
      if (entry.expiresAt <= now) attempts.delete(key);
    }
    const entry = attempts.get(email);
    if (entry) {
      if (entry.count >= MAX_ATTEMPTS) return false;
      entry.count += 1;
      return true;
    }
    if (attempts.size >= MAX_EMAILS) return false;
    attempts.set(email, { count: 1, expiresAt: now + WINDOW_MS });
    return true;
  };
}
