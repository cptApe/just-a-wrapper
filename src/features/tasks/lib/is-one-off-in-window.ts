export function isOneOffInWindow(runAt: Date | null, now: number): boolean {
  if (runAt === null) return false;
  const delay = runAt.getTime() - now;
  return delay > 0 && delay <= 366 * 86400000;
}
