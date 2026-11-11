// Applies the committed Drizzle migration SQL to the test database, then offers
// a truncate-all helper so each test starts from a clean slate. We run the real
// migration files (src/db/migrations/*.sql) rather than a hand-maintained
// schema, so the test DB is exactly what production will be — CHECK/FK/unique
// constraints included. If migrations and schema ever drift, `pnpm drift`
// catches it; here we simply trust the committed SQL.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { makeTestDb } from './test-db';

type Db = ReturnType<typeof makeTestDb>;

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src/db/migrations');

// Drizzle separates statements within a migration file with this marker.
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

// Records which migrations built the schema and what the schema looked like right after.
const MARKER_TABLE = 'integration_schema_marker';

async function migrationFiles(filter: (name: string) => boolean = () => true) {
  const names = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql') && filter(n));
  return Promise.all(
    names.sort().map(async (name) => ({
      name,
      raw: await readFile(path.join(MIGRATIONS_DIR, name), 'utf8'),
    })),
  );
}

/** Runs the chosen migration files in order, without resetting the schema first. */
export async function applyMigrationFiles(
  db: Db,
  filter: (name: string) => boolean,
): Promise<void> {
  for (const { raw } of await migrationFiles(filter)) {
    const statements = raw
      .split(STATEMENT_BREAKPOINT)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }
  }
}

/** Drops every table and reapplies the migrations the filter picks, for tests of one migration. */
export async function resetSchemaTo(db: Db, filter: (name: string) => boolean): Promise<void> {
  await db.execute(sql.raw('drop schema if exists public cascade'));
  await db.execute(sql.raw('create schema public'));
  await applyMigrationFiles(db, filter);
}

// Everything a test could change about the schema itself: columns, constraints, indexes,
// triggers, functions, enums and views. A file that alters any of it forces a rebuild.
async function schemaSignature(db: Db): Promise<string> {
  const result = await db.execute<{ signature: string | null }>(sql`
    select md5(string_agg(d, E'\n' order by d)) as signature from (
      select 'c ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable
        || ' ' || coalesce(column_default, '') as d
        from information_schema.columns
        where table_schema = 'public' and table_name <> ${MARKER_TABLE}
      union all
      select 'k ' || conrelid::regclass::text || ' ' || conname || ' ' || convalidated::text
        || ' ' || pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace
      union all
      select 'i ' || indexdef from pg_indexes where schemaname = 'public'
      union all
      select 't ' || tgrelid::regclass::text || ' ' || tgname || ' ' || tgenabled::text
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
      union all
      select 'f ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid))
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      union all
      select 'e ' || t.typname || ' ' || e.enumlabel
        from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typnamespace = 'public'::regnamespace
      union all
      select 'v ' || viewname from pg_views where schemaname = 'public'
    ) parts`);
  return result.rows[0]?.signature ?? '';
}

async function fingerprint(): Promise<string> {
  const hash = createHash('sha256');
  for (const { name, raw } of await migrationFiles()) hash.update(name).update(raw);
  return hash.digest('hex');
}

async function truncateEveryTable(db: Db): Promise<void> {
  const result = await db.execute<{ tables: string | null }>(sql`
    select string_agg(format('%I.%I', schemaname, tablename), ', ') as tables
      from pg_tables where schemaname = 'public' and tablename <> ${MARKER_TABLE}`);
  const tables = result.rows[0]?.tables;
  if (tables) await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}

/**
 * Leaves the database exactly as a fresh run of every migration would: same schema, no rows.
 * Files run one at a time (fileParallelism: false), so the schema an earlier file built is
 * reused when the migrations and the schema are unchanged, and rebuilt otherwise.
 */
export async function applyMigrations(db: Db): Promise<void> {
  const expected = await fingerprint();
  const exists = await db.execute<{ found: string | null }>(
    sql`select to_regclass(${`public.${MARKER_TABLE}`})::text as found`,
  );
  const stored = exists.rows[0]?.found
    ? (
        await db.execute<{ fingerprint: string; signature: string }>(
          sql`select fingerprint, signature from ${sql.identifier(MARKER_TABLE)}`,
        )
      ).rows[0]
    : undefined;
  if (stored?.fingerprint === expected && stored.signature === (await schemaSignature(db))) {
    await truncateEveryTable(db);
    return;
  }
  await resetSchemaTo(db, () => true);
  const signature = await schemaSignature(db);
  await db.execute(
    sql.raw(`create table ${MARKER_TABLE} (fingerprint text not null, signature text not null)`),
  );
  await db.execute(
    sql`insert into ${sql.identifier(MARKER_TABLE)} (fingerprint, signature) values (${expected}, ${signature})`,
  );
}
// Truncate every app + auth table between tests. RESTART IDENTITY + CASCADE so
// FK chains don't block the wipe and serial/identity counters reset.
const TABLES = [
  'deployment_setting',
  'rate_limit',
  'integration_cleanup',
  'auto_topup_attempt',
  'credit_grant',
  'usage_event',
  'session',
  'processed_webhook_event',
  'workspace_member',
  'workspace',
  'member',
  'invitation',
  'auth_session',
  'account',
  'verification',
  'organization',
  '"user"',
];

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`truncate table ${TABLES.join(', ')} restart identity cascade`));
}

// Minimal Better-Auth-shaped seed rows. The provisioning functions under test
// (provisionWorkspaceForOrg / isOrgFullyProvisioned) only need the FK parents to
// exist: a `user` and an `organization`. We insert them directly rather than
// booting a full auth server.
export async function seedUser(db: Db, id: string, email = `${id}@example.test`): Promise<void> {
  await db.execute(
    sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${id}, ${id}, ${email}, true, now(), now())`,
  );
}

export async function seedOrganization(db: Db, id: string, slug = id, name = id): Promise<void> {
  await db.execute(
    sql`insert into organization (id, name, slug, created_at)
        values (${id}, ${name}, ${slug}, now())`,
  );
}
