import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { task } from './task';
import { workspace } from './workspace';

// An agent session — every chat and task run. `tier` maps to
// one of the three platform-wide agent records (fast/default/pro → user-facing
// Fast/Balanced/Expert, env ANTHROPIC_AGENT_ID_*). The usage columns hold the
// session's running billing totals. `created_by_user_id` FKs
// to `user` ON DELETE restrict — sessions are billing/audit records, removed only
// through the explicit offboarding cascade.
//
// `status` includes 'rescheduling' (Anthropic session lifecycle).
//
// Better Auth's core auth table is also named `session`; its model name is
// configured as `auth_session` so the two do not collide in one Postgres schema.
export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    tier: text('tier').$type<'fast' | 'default' | 'pro'>().notNull(),
    // Internal run behavior: interactive tasks stay `ask`; scheduled tasks may
    // use `auto` when their explicit Skip confirmations option is enabled.
    workspaceMemoryAccess: text('workspace_memory_access')
      .$type<'none' | 'read_only' | 'read_write'>()
      .notNull(),
    permissionMode: text('permission_mode').$type<'ask' | 'auto'>().notNull().default('ask'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    visibility: text('visibility').$type<'private' | 'workspace'>().notNull().default('private'),
    // Set only by trusted server callers for app-initiated work.
    kind: text('kind').$type<'chat' | 'task_run'>().notNull(),
    // The owning task for `kind='task_run'` rows: set when a
    // deployment-created session is adopted via webhook/run-now, or when a
    // Composio trigger fires. Null for chats.
    taskId: uuid('task_id').references(() => task.id),
    anthropicSessionId: text('anthropic_session_id'),
    // The task's one reconnectable Browserbase session. The remote browser is
    // kept alive between custom-tool invocations; status + timestamps make its
    // lifecycle and wall-clock billing durable across server instances.
    browserbaseSessionId: text('browserbase_session_id'),
    browserbaseSessionStatus: text('browserbase_session_status').$type<
      'active' | 'user' | 'acting' | 'closing' | 'closed' | 'ended'
    >(),
    browserbaseSessionStartedAt: timestamp('browserbase_session_started_at', {
      withTimezone: true,
    }),
    browserbaseSessionEndedAt: timestamp('browserbase_session_ended_at', { withTimezone: true }),
    browserbaseSessionUrl: text('browserbase_session_url'),
    browserbaseSessionTitle: text('browserbase_session_title'),
    browserLeaseExpiresAt: timestamp('browser_lease_expires_at', { withTimezone: true }),
    title: text('title'),
    // Bounded, denormalized user + final-assistant text for conversation search.
    // Null means no turn has completed yet; an empty string means the session
    // was indexed but had no searchable message text.
    searchText: text('search_text'),
    // The terminal event whose turn was most recently appended. Concurrent
    // relay tabs can observe the same end_turn; this makes their UPDATEs
    // idempotent without another read or a second table.
    searchTextEventId: text('search_text_event_id'),
    // 'requires_input' is OUR status (like 'paused_no_credits'): Anthropic
    // reports it as idle + stop_reason 'requires_action'; we persist it
    // distinctly so the sidebar can show "requires input" without re-deriving
    // stop reasons (sync-session-status.ts owns the mapping).
    status: text('status')
      .$type<
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
        | 'terminated'
      >()
      .notNull()
      .default('idle'),
    // Terminal review result for scheduled task runs. Null for ordinary
    // sessions, runs without success criteria, and reviews still in progress.
    reviewOutcome: text('review_outcome').$type<
      'passed' | 'passed_after_revision' | 'not_passed'
    >(),
    // Runtime high-water mark: the provider's cumulative active seconds already recorded.
    containerSeconds: integer('container_seconds').notNull().default(0),
    // Credits charged for this session, and its exact customer-billable vendor cost. Each usage
    // event charges creditsForVendorCents(vendor_cost_cents) - credits_consumed, so the rounding
    // to a whole credit is paid once per session.
    creditsConsumed: integer('credits_consumed').notNull().default(0),
    vendorCostCents: numeric('vendor_cost_cents', { precision: 20, scale: 6, mode: 'number' })
      .notNull()
      .default(0),
    // Soft delete (sidebar "Delete"). Sessions are billing/audit records — rows
    // are never hard-DELETEd; a set timestamp hides the session from every list.
    // The archive lifecycle is visible, then hidden (terminal), then archived upstream;
    // session-transitions.ts owns it and the CHECKs below forbid any other combination.
    providerArchivedAt: timestamp('provider_archived_at', { withTimezone: true }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    // Sidebar favorite marker; set = favorited (the timestamp orders favorites).
    favoritedAt: timestamp('favorited_at', { withTimezone: true }),
    // When the session entered `paused_no_credits` (set by the pause claim,
    // cleared on resume). The pause episode remains stable across recovery attempts.
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    // Distinguishes workspace-credit exhaustion from Anthropic's per-session
    // spending cap. Top-ups auto-resume only the former.
    pausedReason: text('paused_reason').$type<'credits' | 'budget' | 'member_limit'>(),
    stopReason: text('stop_reason').$type<
      'end_turn' | 'requires_action' | 'budget_reached' | 'retries_exhausted' | 'interrupted'
    >(),
    stateVersion: integer('state_version').notNull().default(0),
    lastStatusProbeAt: timestamp('last_status_probe_at', { withTimezone: true }),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    usageReconciledAt: timestamp('usage_reconciled_at', { withTimezone: true }),
    usageReconcileAttemptedAt: timestamp('usage_reconcile_attempted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sidebar lists a workspace's sessions ordered by recency.
    index('session_workspace_id_last_event_at_idx').on(t.workspaceId, t.lastEventAt),
    // The stale-session sweep finds its candidates by status and recency through this index.
    index('session_status_last_event_at_idx').on(t.status, t.lastEventAt),
    // /scheduled history + "latest run for task" lookups join runs by task.
    index('session_task_id_idx').on(t.taskId).where(sql`${t.taskId} is not null`),
    // The ownership gate (stream/send routes) looks a session up by its Anthropic
    // id on every request; this is also the one-row-per-Anthropic-session invariant
    // the gate relies on. Partial: the column is null for not-yet-relayed sessions.
    uniqueIndex('session_anthropic_session_id_uidx')
      .on(t.anthropicSessionId)
      .where(sql`${t.anthropicSessionId} is not null`),
    uniqueIndex('session_workspace_active_browser_uidx')
      .on(t.workspaceId)
      .where(sql`${t.browserbaseSessionStatus} in ('active', 'user', 'acting', 'closing')`),
    check(
      'session_stop_reason_check',
      sql`${t.stopReason} in ('end_turn', 'requires_action', 'budget_reached', 'retries_exhausted', 'interrupted')`,
    ),
    check(
      'session_pause_consistency_check',
      sql`(${t.status} in ('pausing', 'paused_no_credits', 'resuming') and ${t.pausedAt} is not null and ${t.pausedReason} is not null) or (${t.status} not in ('pausing', 'paused_no_credits', 'resuming') and ${t.pausedAt} is null and ${t.pausedReason} is null)`,
    ),
    check(
      'session_hidden_check',
      sql`${t.hiddenAt} is null or ${t.status} in ('creation_cleanup', 'terminated')`,
    ),
    check(
      'session_archive_check',
      sql`${t.providerArchivedAt} is null or ${t.hiddenAt} is not null`,
    ),
    check('session_tier_check', sql`${t.tier} in ('fast', 'default', 'pro')`),
    check('session_permission_mode_check', sql`${t.permissionMode} in ('ask', 'auto')`),
    check('session_visibility_check', sql`${t.visibility} in ('private', 'workspace')`),
    check('session_kind_check', sql`${t.kind} in ('chat', 'task_run')`),
    check(
      'session_status_check',
      sql`${t.status} in ('creating', 'creation_cleanup', 'awaiting_opening', 'opening', 'resuming', 'idle', 'running', 'rescheduling', 'requires_input', 'pausing', 'paused_no_credits', 'terminated')`,
    ),
    check(
      'session_review_outcome_check',
      sql`${t.reviewOutcome} in ('passed', 'passed_after_revision', 'not_passed')`,
    ),
    check(
      'session_paused_reason_check',
      sql`${t.pausedReason} in ('credits', 'budget', 'member_limit')`,
    ),
    check(
      'session_workspace_memory_access_check',
      sql`${t.workspaceMemoryAccess} in ('none', 'read_only', 'read_write')`,
    ),
    check(
      'session_browser_lease_check',
      sql`(${t.browserbaseSessionStatus} is not null and ${t.browserbaseSessionStatus} in ('user', 'acting', 'closing')) = (${t.browserLeaseExpiresAt} is not null)`,
    ),
    check(
      'session_browser_end_check',
      sql`(${t.browserbaseSessionStatus} is not null and ${t.browserbaseSessionStatus} in ('closed', 'ended')) = (${t.browserbaseSessionEndedAt} is not null)`,
    ),
    check(
      'session_browser_identity_check',
      sql`(${t.browserbaseSessionStatus} is null and ${t.browserbaseSessionId} is null) or (${t.browserbaseSessionStatus} is not null and ${t.browserbaseSessionId} is not null and ${t.browserbaseSessionStartedAt} is not null)`,
    ),
    check(
      'session_browserbase_session_status_check',
      sql`${t.browserbaseSessionStatus} is null or ${t.browserbaseSessionStatus} in ('active', 'user', 'acting', 'closing', 'closed', 'ended')`,
    ),
  ],
);
