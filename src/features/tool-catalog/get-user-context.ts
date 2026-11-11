import { z } from 'zod';
import { PLANS, type WorkspacePlan } from '@/features/billing/pricing-config';
import type { CustomToolDeclaration } from './types';

// Pure get_user_context schema and projection shared by seed and server handler.
// Return current user, workspace and capability facts without secrets, card data
// or other members’ emails. Tests assert the exact output key set.

export const GET_USER_CONTEXT_NAME = 'get_user_context';

export const GET_USER_CONTEXT_DECL: CustomToolDeclaration<typeof GET_USER_CONTEXT_NAME> = {
  name: GET_USER_CONTEXT_NAME,
  description:
    "Look up the current, live facts about the user and workspace you are working for: their display name, email, and timezone; the workspace name, the user's role in it, the current plan, and how many credits remain; which apps are connected; and which skills are available. Use this to ground a personalized reply in who the user is and what they have set up, rather than guessing or relying on a stale assumption. Takes no input. This is a built-in ability: no setup or connection is needed.",
  riskLevel: 'safe',
  // No arguments: the tool reports the caller's own context, resolved from the
  // session, so there is nothing for the agent to pass.
  inputJsonSchema: {
    type: 'object',
    properties: {},
  },
};

export const GetUserContextInputSchema = z.object({});

export type GetUserContextInput = z.infer<typeof GetUserContextInputSchema>;

/** Plan label for a workspace with no active subscription. */
const NO_PLAN_NAME = 'No plan';

/** Plan label when this deployment has no billing, so no limits apply. */
export const UNLIMITED_PLAN_NAME = 'Unlimited';

/**
 * The plan name the tool reports: the configured plan name for a subscribed
 * workspace, "No plan" otherwise. Read from the workspace row, never from
 * Stripe, so a billing outage cannot fail a read-only context lookup.
 */
export function pickPlanName(planTier: WorkspacePlan): string {
  return planTier === 'none' ? NO_PLAN_NAME : PLANS[planTier].name;
}

export const GetUserContextOutputSchema = z.object({
  user: z.object({
    /** Display name, or null when the user has not set one. */
    displayName: z.string().nullable(),
    email: z.string(),
    /** Effective IANA zone the agent should reason in (UTC when unset), mirroring session mint. */
    timezone: z.string(),
  }),
  workspace: z.object({
    /** Workspace (organization) name, or null when unnamed. */
    name: z.string().nullable(),
    /** The user's role in this workspace (e.g. "owner", "member"). */
    role: z.string(),
    /** Plan name ("Free" when unsubscribed, else the subscription's plan name). */
    plan: z.string(),
    /** Remaining balance in CREDITS (not cents) — the same stored balance billing reads. */
    creditsRemaining: z.number(),
  }),
  /** Names of the apps this member has connected (empty when none or unavailable). */
  connectedApps: z.array(z.string()),
  /** Names of the skills available to this workspace. */
  skills: z.array(z.string()),
});

export type GetUserContextOutput = z.infer<typeof GetUserContextOutputSchema>;

/**
 * The already-resolved facts the handler gathers from the DB and live reads.
 * Kept as a flat, dependency-free record so the projection is pure and testable
 * against mocked rows without a database.
 */
export type UserContextFacts = {
  displayName: string | null;
  email: string;
  timezone: string;
  workspaceName: string | null;
  role: string;
  plan: string;
  creditsRemaining: number;
  connectedApps: string[];
  skills: string[];
};

/**
 * Shape the gathered facts into the tool's output contract. The SINGLE place the
 * output key set is decided (parse-don't-validate: the DB reads narrow at their
 * own boundaries, this only projects). Deliberately drops everything not in the
 * contract, so a secret-shaped field can never leak into the agent's context.
 */
export function projectUserContext(facts: UserContextFacts): GetUserContextOutput {
  return {
    user: {
      displayName: facts.displayName,
      email: facts.email,
      timezone: facts.timezone,
    },
    workspace: {
      name: facts.workspaceName,
      role: facts.role,
      plan: facts.plan,
      creditsRemaining: facts.creditsRemaining,
    },
    connectedApps: facts.connectedApps,
    skills: facts.skills,
  };
}
