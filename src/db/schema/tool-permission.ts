import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { workspaceMember } from './workspace-member';

// Per-member per-toolkit per-tool permission policy: what
// happens when the agent wants to run an integration action. `allow` skips the
// ask-gate, `ask` always gates (even in a session-auto run), `block` is denied
// server-side at the relay gate. Rows are scoped to the workspace member who
// owns the connection — the composite FK mirrors workspace_member's PK and
// cascades with it (a policy is meaningless without its member).
//
// `tool_name` is the exact Composio action slug (e.g. GMAIL_SEND_EMAIL) or, under
// the `builtin` toolkit, a custom tool name. Only exact rows exist: with no row
// the gate applies the access default or session mode. The PK doubles as the
// resolution index.

export const toolPermission = pgTable(
  'tool_permission',
  {
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    // Composio toolkit slug, lowercase (the user-visible "integration").
    toolkit: text('toolkit').notNull(),
    toolName: text('tool_name').notNull(),
    policySource: text('policy_source').$type<'default' | 'member'>().notNull().default('member'),
    policy: text('policy').$type<'allow' | 'ask' | 'block'>().notNull(),
    // Optional per-tool settings that are NOT permission: the user's
    // chosen default generation quality for generate_image / generate_video.
    // Nullable — most rows carry none. The shape is only a type-level hint; the
    // value is Zod-parsed at every read boundary (permissions/lib/tool-settings)
    // before it is trusted, since the column can hold arbitrary prior JSON.
    settings: jsonb('settings').$type<{ defaultQuality?: 'low' | 'mid' | 'high' }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId, t.toolkit, t.toolName] }),
    foreignKey({
      name: 'tool_permission_member_fk',
      columns: [t.organizationId, t.userId],
      foreignColumns: [workspaceMember.organizationId, workspaceMember.userId],
    }).onDelete('cascade'),
    check('tool_permission_policy_source_check', sql`${t.policySource} in ('default', 'member')`),
    check('tool_permission_policy_check', sql`${t.policy} in ('allow', 'ask', 'block')`),
    check('tool_permission_toolkit_check', sql`${t.toolkit} <> ''`),
    check('tool_permission_tool_name_check', sql`${t.toolName} <> ''`),
    // No wildcard rows: every policy names one tool the gate reads exactly.
    check('tool_permission_exact_tool_check', sql`${t.toolName} not like '*%'`),
  ],
);
