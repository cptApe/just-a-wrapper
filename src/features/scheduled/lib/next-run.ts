export function futureNextRun(candidate: Date | null, now: number): Date | null {
  return candidate && candidate.getTime() > now ? candidate : null;
}
