type PauseReason = 'credits' | 'member_limit' | 'budget';

// The credits.paused notice data, shared by a paused session and a refused event run. The reason
// rides along so the feed and the email can leave out a button that cannot help.
export function creditPauseNotice(reason: PauseReason): {
  title: string;
  body: string | undefined;
  pauseReason: PauseReason;
} {
  return { ...pauseWords(reason), pauseReason: reason };
}

function pauseWords(reason: PauseReason): { title: string; body: string | undefined } {
  switch (reason) {
    case 'budget':
      return { title: 'Agent paused', body: 'Session reached its spending cap.' };
    case 'member_limit':
      return {
        title: 'Agent paused, member limit reached',
        body: 'This member reached their credit limit for the current billing period.',
      };
    case 'credits':
      return { title: 'Agent paused, out of credits', body: undefined };
  }
}
