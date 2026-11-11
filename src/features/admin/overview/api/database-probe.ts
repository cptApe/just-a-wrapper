import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { captureException } from '@/lib/observability';
import { probeResultForError } from '../lib/database-probe-result';
import type { DatabaseProbe } from '../types';

// One read of a table the first migration creates proves the database answers
// and has a schema. An unreachable database resolves to a value, so the
// Overview still loads when Postgres is down.

const PROBE_STATEMENT = sql`select 1 from "workspace" limit 1`;

export async function probeDatabase(): Promise<DatabaseProbe> {
  try {
    await db.execute(PROBE_STATEMENT);
    return { kind: 'ready' };
  } catch (error) {
    const probe = probeResultForError(error);
    // A database nobody has migrated yet is a state, not an incident.
    if (probe.kind !== 'no-schema') {
      captureException(error, { feature: 'admin', op: 'overview.database-probe' });
    }
    return probe;
  }
}
