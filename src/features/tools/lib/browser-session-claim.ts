type BrowserSessionWinner = { id: string; url: string; title: string };

/** Resolve concurrent first opens to one persisted Browserbase session. The
 * database claim is authoritative; every losing paid candidate is released
 * before its caller converges on the winner. */
export async function resolveBrowserSessionClaim(input: {
  candidateId: string;
  claim: () => Promise<boolean>;
  releaseCandidate: () => Promise<void>;
  readWinner: () => Promise<BrowserSessionWinner | null>;
}): Promise<
  | { claimed: true; winner: { id: string } }
  | { claimed: false; winner: BrowserSessionWinner | null }
> {
  if (await input.claim()) {
    return { claimed: true, winner: { id: input.candidateId } };
  }
  await input.releaseCandidate();
  return { claimed: false, winner: await input.readWinner() };
}
