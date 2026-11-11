import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { session } from './session';
import { workspace } from './workspace';

// Append-only audit trail of usage: one row per usage event, with its exact vendor cost and the
// credits it charged (`credits_delta` is signed). A session's rows may charge 0 credits for a
// positive cost, because the session rounds its running total once (`session.vendor_cost_cents`).
// `usage_key` is the idempotency key of the event: a provider event id, or a `tool:`, `tts:`,
// `voice:`, `title:` or `runtime:` key. A redelivered event hits its partial unique index and is
// skipped (INSERT ... ON CONFLICT DO NOTHING) instead of charging twice.
export const usageEvent = pgTable(
  'usage_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    sessionId: uuid('session_id').references(() => session.id),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    eventType: text('event_type')
      .$type<
        | 'model_request'
        | 'tool_call'
        | 'container_runtime'
        // Voice spend: dictation + read-aloud.
        | 'voice_transcription'
        | 'voice_tts'
        // Media generation: the same at-cost conversion as tool_call, tagged separately.
        | 'generation'
        // Naming a new chat; always paid by the platform.
        | 'title_generation'
      >()
      .notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    cacheCreationTokens: integer('cache_creation_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    // Runtime seconds this event added; set only on container_runtime rows.
    containerSeconds: integer('container_seconds'),
    // Whole seconds of transcribed audio; set only on voice_transcription rows.
    audioSeconds: integer('audio_seconds'),
    platformPaid: boolean('platform_paid').notNull().default(false),
    // Fractional vendor cents, before credit rounding. Null on historical rows.
    vendorCostCents: numeric('vendor_cost_cents', { precision: 20, scale: 6, mode: 'number' }),
    settlementStatus: text('settlement_status')
      .$type<'pending' | 'complete'>()
      .notNull()
      .default('complete'),
    creditsDelta: integer('credits_delta').notNull(),
    usageKey: text('usage_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'usage_event_pending_settlement_identity_check',
      sql`${t.settlementStatus} <> 'pending' or ${t.usageKey} is not null`,
    ),
    check(
      'usage_event_settlement_status_check',
      sql`${t.settlementStatus} in ('pending', 'complete')`,
    ),
    check('usage_event_vendor_cost_check', sql`${t.vendorCostCents} >= 0`),
    check(
      'usage_event_platform_paid_check',
      sql`not ${t.platformPaid} or (${t.creditsDelta} = 0 and ${t.vendorCostCents} is not null)`,
    ),
    index('usage_event_workspace_id_created_at_idx').on(t.workspaceId, t.createdAt),
    uniqueIndex('usage_event_usage_key_uidx').on(t.usageKey).where(sql`${t.usageKey} is not null`),
    check(
      'usage_event_event_type_check',
      sql`${t.eventType} in ('model_request', 'tool_call', 'container_runtime', 'voice_transcription', 'voice_tts', 'generation', 'title_generation')`,
    ),
    check(
      'usage_event_container_seconds_check',
      sql`${t.containerSeconds} is null or ${t.eventType} = 'container_runtime'`,
    ),
    check(
      'usage_event_audio_seconds_check',
      sql`${t.audioSeconds} is null or ${t.eventType} = 'voice_transcription'`,
    ),
  ],
);
