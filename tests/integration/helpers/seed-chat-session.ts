/** Chat fixtures use the current schema so required privacy fields are checked by TypeScript. */
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { session, workspace } from '@/db/schema';
import type { makeTestDb } from './test-db';

export async function seedChatSession(
  database: ReturnType<typeof makeTestDb>,
  organizationId: string,
  input: Omit<typeof session.$inferInsert, 'workspaceId' | 'tier' | 'kind'>,
) {
  const parent = (
    await database
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
  ).at(0);
  assert.ok(parent, `Missing workspace for ${organizationId}`);
  const row = (
    await database
      .insert(session)
      .values({
        ...input,
        workspaceId: parent.id,
        tier: 'default',
        kind: 'chat',
      })
      .returning()
  ).at(0);
  assert.ok(row, 'Chat fixture was not inserted');
  return row;
}
