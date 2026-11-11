import { z } from 'zod';

// The server records when it first saw a key, so the browser keeps only the key itself.
// Entries written before that still carry a createdAt, which is ignored.
const attemptSchema = z.object({ key: z.uuid() });
export function readTopupAttempt(storageKey: string): { key: string } {
  const stored = localStorage.getItem(storageKey);
  if (stored !== null) return { key: attemptSchema.parse(JSON.parse(stored)).key };
  const attempt = { key: crypto.randomUUID() };
  localStorage.setItem(storageKey, JSON.stringify(attempt));
  return attempt;
}

export function finishTopupAttempt(
  workspaceId: string,
  purchase: { key: string; credits: number },
): void {
  const storageKey = `billing-topup:${workspaceId}:${purchase.credits}`;
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return;
  const attempt = attemptSchema.parse(JSON.parse(raw));
  if (attempt.key === purchase.key) localStorage.removeItem(storageKey);
}
