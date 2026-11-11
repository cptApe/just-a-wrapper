import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

// A scheduled or event-triggered routine. `description` is sent as the
// kickoff user message of the task-run session. `auto_approve` opts the run into
// permission_mode='auto'. `created_by_user_id` FKs to `user` ON DELETE restrict —
// tasks own external state (Composio triggers / Anthropic deployments) that must
// be torn down explicitly at offboarding, not silently dropped.
export const task = pgTable(
  'task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    tier: text('tier').$type<'fast' | 'default' | 'pro'>().notNull().default('default'),
    autoApprove: boolean('auto_approve').notNull().default(false),
    // Per-schedule notification choice for its runs:
    // email_app | email | app | off. Gates task.completed / failed / needs_input.
    notification: text('notification')
      .$type<'email_app' | 'email' | 'app' | 'off'>()
      .notNull()
      .default('email_app'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    visibility: text('visibility').$type<'private' | 'workspace'>().notNull().default('private'),
    title: text('title').notNull(),
    icon: text('icon'),
    description: text('description'),
    // Optional plain-language completion criteria, sent to Anthropic as the
    // deployment's outcome rubric for every scheduled run.
    successCriteria: text('success_criteria'),
    // Files the schedule carries into every run: Library files by durable URL
    // and Library folders by path. Written into the kickoff message
    // as the chat composer's <attached_files> block.
    attachments: jsonb('attachments').$type<{
      files: Array<{ id: string; name: string; url: string; mimeType: string; sizeBytes: number }>;
      folders: Array<{ path: string; name: string; itemCount: number }>;
    }>(),
    // The app's truth. A provider change it needs is recorded in provider_sync, not in status.
    status: text('status')
      .$type<'creating' | 'upcoming' | 'paused' | 'running' | 'done' | 'removed'>()
      .notNull()
      .default('upcoming'),
    // Counts every change to the definition or lifecycle. An edit must name the version it read.
    version: integer('version').notNull().default(1),
    // What the provider still has to be told: nothing, the status, or the whole definition.
    providerSync: text('provider_sync')
      .$type<'synced' | 'status' | 'definition'>()
      .notNull()
      .default('synced'),
    // Lease of the one worker pushing this row to the provider; null when nobody holds it.
    syncClaimedAt: timestamp('sync_claimed_at', { withTimezone: true }),
    triggerType: text('trigger_type').$type<'schedule' | 'event'>().notNull(),
    cronSchedule: text('cron_schedule'),
    // Present only for one-off schedules. Anthropic currently accepts cron
    // deployments only, so cron_schedule stays null here while the create path
    // uses a date-specific cron as provider transport and archives it on fire.
    runAt: timestamp('run_at', { withTimezone: true }),
    // IANA timezone the cron expression is evaluated in (deployments require it;
    // kept for display/edit round-trips).
    timezone: text('timezone'),
    // The Anthropic Scheduled Deployment backing a 'schedule' task. Anthropic owns
    // the cron tick; pause/resume/run-now/delete map to deployment endpoints. The
    // deployment's metadata carries task_id, and its created sessions inherit it —
    // the webhook adoption path joins back through this column as the authenticity
    // cross-check.
    anthropicDeploymentId: text('anthropic_deployment_id'),
    deploymentSnapshotHash: text('deployment_snapshot_hash'),
    runsCheckedAt: timestamp('runs_checked_at', { withTimezone: true }),
    deploymentCheckedAt: timestamp('deployment_checked_at', { withTimezone: true }),
    composioTriggerId: text('composio_trigger_id'),
    eventToolkit: text('event_toolkit'),
    eventType: text('event_type'),
    // Runs link the other way: session.task_id → task (1:N — a recurring task
    // produces many `task_run` sessions). The latest run is the newest session
    // row carrying this task's id.
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    // Lease of the one run-now in flight. It ends when that run is known to exist or to have failed.
    runNowClaimedAt: timestamp('run_now_claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_workspace_id_idx').on(t.workspaceId),
    // The /scheduled Upcoming group reads tasks awaiting their next fire (display
    // only — Anthropic owns the actual cron tick via Scheduled Deployments).
    index('task_next_run_at_idx').on(t.nextRunAt).where(sql`${t.status} = 'upcoming'`),
    // Webhook adoption joins session.metadata.task_id back to the task and
    // cross-checks the session's deployment_id against this column; one
    // deployment maps to exactly one task.
    uniqueIndex('task_anthropic_deployment_id_uidx')
      .on(t.anthropicDeploymentId)
      .where(sql`${t.anthropicDeploymentId} is not null`),
    // The Composio webhook maps metadata.trigger_id to its owning task.
    uniqueIndex('task_composio_trigger_id_uidx')
      .on(t.composioTriggerId)
      .where(sql`${t.composioTriggerId} is not null`),
    check('task_tier_check', sql`${t.tier} in ('fast', 'default', 'pro')`),
    check(
      'task_notification_check',
      sql`${t.notification} in ('email_app', 'email', 'app', 'off')`,
    ),
    check('task_visibility_check', sql`${t.visibility} in ('private', 'workspace')`),
    check(
      'task_status_check',
      sql`${t.status} in ('creating', 'upcoming', 'paused', 'running', 'done', 'removed')`,
    ),
    check('task_provider_sync_check', sql`${t.providerSync} in ('synced', 'status', 'definition')`),
    // The sweep reads rows the provider has not caught up with.
    index('task_provider_sync_idx').on(t.syncClaimedAt).where(sql`${t.providerSync} <> 'synced'`),
    check('task_trigger_type_check', sql`${t.triggerType} in ('schedule', 'event')`),
    // A schedule is exactly one of recurring cron or one-off run_at.
    check(
      'task_schedule_definition_check',
      sql`${t.triggerType} <> 'schedule' or (${t.cronSchedule} is not null and ${t.runAt} is null) or (${t.cronSchedule} is null and ${t.runAt} is not null)`,
    ),
  ],
);
