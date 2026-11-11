// Live browser identities share one workspace slot; expired user leases do not reserve it.
type BrowserHolderStatus =
  | 'creating'
  | 'creation_cleanup'
  | 'awaiting_opening'
  | 'opening'
  | 'resuming'
  | 'idle'
  | 'running'
  | 'rescheduling'
  | 'requires_input'
  | 'pausing'
  | 'paused_no_credits'
  | 'terminated';

export type BrowserHolder = {
  /** The holding task's session status (our column; 'running' = mid-turn). */
  status: BrowserHolderStatus | null;
  /** True while a person has taken control of that browser in its panel. */
  controlledByUser: boolean;
};

/** 'busy' keeps today's refusal; 'reclaim' lets the caller end and settle the
 * holder's session before claiming its own. */
export function workspaceBrowserHolderDecision(holder: BrowserHolder): 'busy' | 'reclaim' {
  if (holder.controlledByUser) return 'busy';
  if (
    holder.status === 'opening' ||
    holder.status === 'resuming' ||
    holder.status === 'running' ||
    holder.status === 'rescheduling' ||
    holder.status === 'requires_input'
  )
    return 'busy';
  return 'reclaim';
}
