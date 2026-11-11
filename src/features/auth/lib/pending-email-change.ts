import { z } from 'zod';
import { AppError } from '@/lib/errors';

const changed = 'just-a-wrapper:pending-email-change';
const schema = z.object({ email: z.email(), currentEmail: z.email(), expiresAt: z.number() });
const key = (userId: string) => `just-a-wrapper:pending-email:${userId}`;
export function readPendingEmailChange(userId: string, currentEmail: string): string | null {
  try {
    const stored = window.localStorage.getItem(key(userId));
    if (stored === null) return null;
    const parsed = schema.safeParse(JSON.parse(stored));
    if (
      !parsed.success ||
      parsed.data.currentEmail !== currentEmail ||
      parsed.data.expiresAt <= Date.now()
    )
      return null;
    return parsed.data.email;
  } catch (cause) {
    throw new AppError(
      'UNEXPECTED',
      'Pending email request could not be read',
      { userId },
      { cause },
    );
  }
}
export function savePendingEmailChange(
  userId: string,
  currentEmail: string,
  pendingEmail: string,
): void {
  try {
    window.localStorage.setItem(
      key(userId),
      JSON.stringify({ email: pendingEmail, currentEmail, expiresAt: Date.now() + 3_600_000 }),
    );
  } catch (cause) {
    throw new AppError(
      'UNEXPECTED',
      'Pending email request could not be saved',
      { userId },
      { cause },
    );
  }
  window.dispatchEvent(new Event(changed));
}
export function subscribePendingEmailChange(listener: () => void): () => void {
  window.addEventListener('storage', listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(changed, listener);
  };
}

export function clearVerifiedEmailChange(userId: string, currentEmail: string): void {
  try {
    const stored = window.localStorage.getItem(key(userId));
    if (stored === null) return;
    const parsed = schema.safeParse(JSON.parse(stored));
    if (
      !parsed.success ||
      parsed.data.currentEmail !== currentEmail ||
      parsed.data.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(key(userId));
      window.dispatchEvent(new Event(changed));
    }
  } catch (cause) {
    throw new AppError(
      'UNEXPECTED',
      'Pending email request could not be cleared',
      { userId },
      { cause },
    );
  }
}
