import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { integration, workspace, workspaceMember, workspaceNotDeleted } from '@/db/schema';
import { type ConnectionEdge, connectionEdge, connectionMachine } from '../lib/connection-machine';

type ConnectionKey = Pick<typeof integration.$inferInsert, 'workspaceId' | 'userId' | 'toolkit'>;

function connectionKey(input: ConnectionKey) {
  return and(
    eq(integration.workspaceId, input.workspaceId),
    eq(integration.userId, input.userId),
    eq(integration.toolkit, input.toolkit),
  );
}

async function lockConnectionMember(
  tx: DbTransaction,
  input: Pick<ConnectionKey, 'workspaceId' | 'userId'>,
): Promise<boolean> {
  const rows = await tx
    .select({ id: workspaceMember.composioUserId })
    .from(workspaceMember)
    .innerJoin(
      workspace,
      and(eq(workspace.organizationId, workspaceMember.organizationId), workspaceNotDeleted),
    )
    .where(and(eq(workspace.id, input.workspaceId), eq(workspaceMember.userId, input.userId)))
    .for('update', { of: workspaceMember });
  return rows.length > 0;
}

type Observation = ConnectionKey & { connected: boolean; observedAt: Date };
export async function recordConnectionState(input: Observation): Promise<ConnectionEdge> {
  return db.transaction(async (tx) => {
    if (!(await lockConnectionMember(tx, input))) return 'unchanged';
    return writeConnectionObservation(tx, input);
  });
}

export async function recordConnectionStates(input: {
  workspaceId: string;
  userId: string;
  observedAt: Date;
  connections: Array<{ toolkit: string; connected: boolean }>;
}): Promise<string[]> {
  if (input.connections.length === 0) return [];
  return db.transaction(async (tx) => {
    if (!(await lockConnectionMember(tx, input))) return [];
    const existing = await tx
      .select()
      .from(integration)
      .where(
        and(
          eq(integration.workspaceId, input.workspaceId),
          eq(integration.userId, input.userId),
          inArray(
            integration.toolkit,
            input.connections.map((connection) => connection.toolkit),
          ),
        ),
      );
    const changed = input.connections.filter((connection) => {
      const prior = existing.find((row) => row.toolkit === connection.toolkit);
      if (prior === undefined) return true;
      return (
        prior.observedAt <= input.observedAt &&
        connectionEdge(prior, connection.connected) !== 'unchanged'
      );
    });
    if (changed.length === 0) return [];
    await tx
      .insert(integration)
      .values(
        changed.map((connection) => ({
          workspaceId: input.workspaceId,
          userId: input.userId,
          toolkit: connection.toolkit,
          status: connection.connected ? ('connected' as const) : ('disconnected' as const),
          observedAt: input.observedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [integration.workspaceId, integration.userId, integration.toolkit],
        set: {
          status: sql`excluded.status`,
          observedAt: sql`excluded.observed_at`,
        },
        setWhere: and(
          or(
            and(
              sql`excluded.status = 'connected'`,
              inArray(integration.status, connectionMachine.sourcesOf('connected')),
            ),
            and(
              sql`excluded.status = 'disconnected'`,
              inArray(
                integration.status,
                connectionMachine
                  .sourcesOf('disconnected')
                  .filter((status) => status !== 'disconnecting'),
              ),
            ),
          ),
          sql`${integration.observedAt} <= excluded.observed_at`,
        ),
      });
    return changed.filter((connection) => connection.connected).map(({ toolkit }) => toolkit);
  });
}

async function writeConnectionObservation(
  tx: DbTransaction,
  input: Observation,
): Promise<ConnectionEdge> {
  await tx.insert(integration).values(input).onConflictDoNothing();
  const existing = (
    await tx
      .select({ status: integration.status })
      .from(integration)
      .where(connectionKey(input))
      .for('update')
  ).at(0);
  const edge = connectionEdge(existing, input.connected);
  if (edge === 'unchanged') return edge;
  const to = input.connected ? 'connected' : 'disconnected';
  const moved = await tx
    .update(integration)
    .set({ status: to, observedAt: input.observedAt })
    .where(
      and(
        connectionKey(input),
        lte(integration.observedAt, input.observedAt),
        inArray(
          integration.status,
          connectionMachine.sourcesOf(to).filter((status) => status !== 'disconnecting'),
        ),
      ),
    )
    .returning({ id: integration.id });
  return moved.length === 0 ? 'unchanged' : edge;
}

export async function beginConnectionDisconnect(input: ConnectionKey): Promise<Date | null> {
  return db.transaction(async (tx) => {
    if (!(await lockConnectionMember(tx, input))) return null;
    await tx.insert(integration).values(input).onConflictDoNothing();
    const claimedAt = new Date();
    const moved = await tx
      .update(integration)
      .set({ status: 'disconnecting', observedAt: claimedAt })
      .where(
        and(
          connectionKey(input),
          inArray(integration.status, connectionMachine.sourcesOf('disconnecting')),
          or(
            inArray(integration.status, ['connected', 'disconnected']),
            lt(integration.observedAt, new Date(claimedAt.getTime() - 300_000)),
          ),
        ),
      )
      .returning({ id: integration.id });
    return moved.length > 0 ? claimedAt : null;
  });
}

export async function finishConnectionDisconnect(
  input: ConnectionKey & { claimedAt: Date },
): Promise<boolean> {
  const moved = await db
    .update(integration)
    .set({ status: 'disconnected', observedAt: new Date() })
    .where(
      and(
        connectionKey(input),
        inArray(integration.status, connectionMachine.sourcesOf('disconnected')),
        eq(integration.status, 'disconnecting'),
        eq(integration.observedAt, input.claimedAt),
      ),
    )
    .returning({ id: integration.id });
  return moved.length > 0;
}
