import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { WorkspaceRole } from '@/lib/workspace-role';

export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    // timestamptz (not naive) so it matches deletedAt on this
    // table: a UTC instant, not a wall-clock-in-server-tz value.
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Personal display preferences (Settings/General). timezone is an explicit
    // choice; null means Auto and falls through to browserTimezone, which the app
    // shell detects once per tab session. null timeFormat follows the locale's
    // hour cycle (resolveTimeFormat in features/preferences). Registered as Better Auth additional user fields
    // (src/lib/auth.ts); the CHECK keeps timeFormat to the two valid values.
    timezone: text('timezone'),
    browserTimezone: text('browser_timezone'),
    timeFormat: text('time_format'),
    // The language the agent replies in. Null matches the language the member writes in.
    replyLanguage: text('reply_language'),
    // Account soft-delete (the email-tombstone model). Deleting sets
    // deletedAt = now() and moves the real address into deletedEmail while
    // `email` is rewritten to a per-user tombstone, so login is disabled and the
    // original address is immediately reusable for a fresh signup with no unique
    // conflict. `deletedAt` starts the 30-day window after which the purge job
    // anonymizes the row and then deletes it.
    purgeAttemptedAt: timestamp('purge_attempted_at', { withTimezone: true }),
    accountStatus: text('account_status')
      .$type<'live' | 'deleted' | 'anonymized'>()
      .notNull()
      .default('live'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedEmail: text('deleted_email'),
  },
  (t) => [
    check('user_time_format_check', sql`${t.timeFormat} in ('12h', '24h')`),
    check(
      'user_account_status_check',
      sql`${t.accountStatus} in ('live', 'deleted', 'anonymized')`,
    ),
    check(
      'user_account_tombstone_check',
      sql`(${t.accountStatus} = 'live' and ${t.deletedAt} is null and ${t.deletedEmail} is null) or (${t.accountStatus} in ('deleted', 'anonymized') and ${t.deletedAt} is not null and ${t.email} = 'deleted+' || ${t.id} || '@deleted.agentcore.local' and (${t.accountStatus} <> 'anonymized' or ${t.deletedEmail} is null))`,
    ),
  ],
);

export const auth_session = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
  },
  (table) => [index('auth_session_userId_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    purgeAttemptedAt: timestamp('purge_attempted_at', { withTimezone: true }),
    createdAt: timestamp('created_at').notNull(),
    metadata: text('metadata'),
  },
  (table) => [uniqueIndex('organization_slug_uidx').on(table.slug)],
);

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<WorkspaceRole>().default('member').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('member_organizationId_idx').on(table.organizationId),
    index('member_userId_idx').on(table.userId),
    uniqueIndex('member_organization_user_uq').on(table.organizationId, table.userId),
    check('member_role_check', sql`${table.role} in ('owner', 'admin', 'member')`),
  ],
);

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').default('member').notNull(),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
    uniqueIndex('invitation_pending_email_uq')
      .on(table.organizationId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
    check(
      'invitation_status_check',
      sql`${table.status} in ('pending', 'accepted', 'rejected', 'canceled')`,
    ),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  auth_sessions: many(auth_session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
}));

export const auth_sessionRelations = relations(auth_session, ({ one }) => ({
  user: one(user, {
    fields: [auth_session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));
