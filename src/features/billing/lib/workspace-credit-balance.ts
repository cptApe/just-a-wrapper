import { sql } from 'drizzle-orm';
import { creditGrant } from '@/db/schema';

// Time alone activates and expires grants, so every reader derives the balance at statement time.
export const workspaceCreditBalance = sql<number>`(select coalesce(sum(balance_grant.amount - balance_grant.consumed), 0)::int from ${creditGrant} balance_grant where balance_grant.workspace_id = "workspace"."id" and balance_grant.status = 'issued' and balance_grant.issued_at <= now() and balance_grant.expires_at > now())`;
