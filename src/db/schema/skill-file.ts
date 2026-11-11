import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { skill } from './skill';

// One file of a skill folder. `path` is
// relative to the skill root ('SKILL.md', 'references/pricing.md') — the
// Anthropic upload prefixes it with the skill directory at push time. UTF-8
// text only; binary assets are rejected at the upload boundary. The path
// checks make traversal unrepresentable at the storage layer, not just at
// parse time.
export const skillFile = pgTable(
  'skill_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skill.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('skill_file_skill_id_path_uidx').on(t.skillId, t.path),
    check('skill_file_path_check', sql`${t.path} <> ''`),
    check('skill_file_path_relative_check', sql`${t.path} not like '/%'`),
    check(
      'skill_file_path_no_traversal_check',
      sql`${t.path} not like '%..%' and ${t.path} not like '%//%'`,
    ),
  ],
);
