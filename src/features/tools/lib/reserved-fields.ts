// Billing metadata stays available for accrual but must never reach the agent context.
import { z } from 'zod';

const RESERVED_BILLING_KEYS = ['vendorCostCents', 'mediaBilling'] as const;

/** Remove reserved billing metadata from a tool result before it is posted to
 * the agent. Non-object results (rare) pass through untouched. */
export function stripReservedBillingFields(content: unknown): unknown {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return content;
  const clone: Record<string, unknown> = z.record(z.string(), z.unknown()).parse(content);
  for (const key of RESERVED_BILLING_KEYS) delete clone[key];
  return clone;
}
