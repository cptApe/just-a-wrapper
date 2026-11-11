import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { type SKILL_KINDS, SKILL_STATUSES } from './skill-kinds';
import { workspace } from './workspace';

// Preset source hashes trigger new versions when git content changes.
// Publication payloads make provider calls recoverable after a local failure.
export const skill = pgTable(
  'skill',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    anthropicSkillId: text('anthropic_skill_id'),
    kind: text('kind').$type<(typeof SKILL_KINDS)[number]>().notNull(),
    ownerWorkspaceId: uuid('owner_workspace_id').references(() => workspace.id),
    // The member who first saved a custom skill. Null for presets, Anthropic
    // skills and rows saved before authors were recorded.
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    latestVersion: text('latest_version'),
    sourceHash: text('source_hash'),
    revision: integer('revision').notNull().default(0),
    status: text('status').$type<(typeof SKILL_STATUSES)[number]>().notNull().default('ready'),
    publication: jsonb('publication').$type<{
      token: string;
      previousName: string;
      versionOf: string | null;
      name: string;
      description: string | null;
      directory: string;
      files: { path: string; content: string }[];
      sourceHash: string | null;
    }>(),
    retainedSkillIds: jsonb('retained_skill_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Global rows deduplicate remote identities; workspace names remain independently owned.
    uniqueIndex('skill_anthropic_skill_id_uidx')
      .on(t.anthropicSkillId)
      .where(sql`${t.anthropicSkillId} is not null and ${t.ownerWorkspaceId} is null`),
    // One skill per name within a workspace — the create path reserves a row by
    // (owner, name) before pushing upstream, so a duplicate-name request fails
    // locally before any Anthropic call. NULL owners are distinct in Postgres,
    // so global rows are deduped by the index below instead.
    uniqueIndex('skill_owner_workspace_id_name_uidx').on(t.ownerWorkspaceId, t.name),
    // Global names deduplicate concurrent preset reservations.
    uniqueIndex('skill_global_name_uidx').on(t.name).where(sql`${t.ownerWorkspaceId} is null`),
    check(
      'skill_status_check',
      sql`${t.status} in (${sql.join(
        SKILL_STATUSES.map((status) => sql.raw(`'${status}'`)),
        sql`, `,
      )})`,
    ),
    check(
      'skill_publication_check',
      sql`(${t.status} = 'publishing' and ${t.publication} is not null) or (${t.status} = 'ready' and ${t.publication} is null) or ${t.status} = 'deleting'`,
    ),
    // A ready null-id row is an unpublished reservation; create or update can claim it.
    check(
      'skill_remote_version_check',
      sql`(${t.anthropicSkillId} is null) = (${t.latestVersion} is null)`,
    ),
    check('skill_kind_check', sql`${t.kind} in ('anthropic', 'preset', 'custom')`),
    // The kind/owner invariant: global kinds never carry an owner; customs
    // always do. Enforced in SQL so neither a code bug nor a raw insert can
    // create an ownerless custom or an owned preset.
    check(
      'skill_owner_kind_check',
      sql`(${t.kind} in ('anthropic', 'preset') and ${t.ownerWorkspaceId} is null) or (${t.kind} = 'custom' and ${t.ownerWorkspaceId} is not null)`,
    ),
  ],
);
