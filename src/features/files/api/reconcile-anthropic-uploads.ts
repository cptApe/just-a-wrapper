import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import type { FileMetadata } from '@anthropic-ai/sdk/resources/beta/files';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { file, session, sessionFileMount } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { captureException } from '@/lib/observability';
import { assertBeforeDeadline } from '@/lib/sweep-deadline';

const REQUEST_OPTIONS = { timeout: 10_000, maxRetries: 0 };
const FILE_BETAS: Array<'files-api-2025-04-14'> = ['files-api-2025-04-14'];
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OWNED_UPLOAD = new RegExp(`^agentcore_(${UUID_PATTERN})_(${UUID_PATTERN}|none)_`);

type UploadReport = {
  matched: Array<{
    anthropicFileId: string;
    sessionId: string;
    workspaceId: string;
    action: 'retain' | 'delete';
  }>;
  retained: number;
  deleted: number;
  unmatched: string[];
  failed: Array<{ id: string; error: string }>;
};

type ReconcileInput = {
  dryRun: boolean;
  deadline: number;
  scope: 'inventory' | 'orphans';
};
type AnthropicClient = NonNullable<ReturnType<typeof getAnthropicClient>>;
type SessionOwner = typeof session.$inferSelect;

// Unmatched organization files are inventory only: a filename cannot establish another tenant's ownership.
export async function reconcileAnthropicUploads(input: ReconcileInput) {
  const report: UploadReport = { matched: [], retained: 0, deleted: 0, unmatched: [], failed: [] };
  const client = getAnthropicClient();
  if (!client) return report;
  const { uploads, sessionIds } = await listCandidateUploads(client, input, report);
  if (uploads.length === 0) return report;
  const owners = await db
    .select()
    .from(session)
    .where(
      and(
        isNotNull(session.anthropicSessionId),
        input.scope === 'orphans' ? inArray(session.id, sessionIds) : undefined,
      ),
    );
  const byId = new Map(owners.map((owner) => [owner.id, owner]));
  const resources = await readSessionFileOwners(client, owners, input.deadline);
  for (const upload of uploads) {
    assertBeforeDeadline(input.deadline);
    // One mount row cannot represent shared provider files; leave ambiguous ownership for review.
    if (resources.has(upload.id) && resources.get(upload.id) === null) {
      report.unmatched.push(upload.id);
      continue;
    }
    const match = OWNED_UPLOAD.exec(upload.filename);
    const owner = resources.get(upload.id) ?? (match?.[1] ? byId.get(match[1]) : undefined);
    if (!owner) {
      report.unmatched.push(upload.id);
      continue;
    }
    const orphaned =
      !resources.has(upload.id) && Date.parse(upload.created_at) < Date.now() - 86_400_000;
    report.matched.push({
      anthropicFileId: upload.id,
      sessionId: owner.id,
      workspaceId: owner.workspaceId,
      action: orphaned ? 'delete' : 'retain',
    });
    try {
      if (orphaned) {
        if (!input.dryRun)
          await client.beta.files.delete(upload.id, { betas: FILE_BETAS }, REQUEST_OPTIONS);
        report.deleted += 1;
        continue;
      }
      const fileId = await readSourceFileId(match?.[2], owner.workspaceId);
      if (!input.dryRun)
        await db
          .insert(sessionFileMount)
          .values({
            anthropicFileId: upload.id,
            workspaceId: owner.workspaceId,
            sessionId: owner.id,
            fileId,
          })
          .onConflictDoNothing();
      report.retained += 1;
    } catch (cause) {
      captureException(cause, { feature: 'files', op: 'retention-retry' });
      // Preserve each failed identity in the report; the next sweep retries it from the provider inventory.
      report.failed.push({
        id: upload.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return report;
}

async function listCandidateUploads(
  client: AnthropicClient,
  input: ReconcileInput,
  report: UploadReport,
): Promise<{ uploads: FileMetadata[]; sessionIds: string[] }> {
  const tracked = new Set(
    (await db.select().from(sessionFileMount)).map((mount) => mount.anthropicFileId),
  );
  const uploads: FileMetadata[] = [];
  const sessionIds = new Set<string>();
  for await (const upload of client.beta.files.list({ betas: FILE_BETAS }, REQUEST_OPTIONS)) {
    assertBeforeDeadline(input.deadline);
    if (tracked.has(upload.id) || upload.downloadable === true) continue;
    const match = OWNED_UPLOAD.exec(upload.filename);
    if (input.scope === 'orphans') {
      if (!match?.[1]) {
        report.unmatched.push(upload.id);
        continue;
      }
      if (!(Date.parse(upload.created_at) < Date.now() - 86_400_000)) continue;
      sessionIds.add(match[1]);
    }
    uploads.push(upload);
  }
  return { uploads, sessionIds: [...sessionIds] };
}

// Complete the resource inventory before any deletion. An unreadable session aborts safely.
// A file mounted in two sessions maps to null because it has no single owner.
async function readSessionFileOwners(
  client: AnthropicClient,
  owners: SessionOwner[],
  deadline: number,
): Promise<Map<string, SessionOwner | null>> {
  const resources = new Map<string, SessionOwner | null>();
  for (const owner of owners) {
    assertBeforeDeadline(deadline);
    if (owner.anthropicSessionId === null) continue;
    try {
      for await (const resource of client.beta.sessions.resources.list(
        owner.anthropicSessionId,
        null,
        REQUEST_OPTIONS,
      )) {
        assertBeforeDeadline(deadline);
        if (resource.type === 'file') {
          const previous = resources.get(resource.file_id);
          resources.set(
            resource.file_id,
            previous === undefined || previous?.id === owner.id ? owner : null,
          );
        }
      }
    } catch (cause) {
      // A deleted upstream session owns no surviving resources; other inventory failures stop deletion.
      if (!(cause instanceof APIError && cause.status === 404)) throw cause;
    }
  }
  return resources;
}

async function readSourceFileId(
  sourceId: string | undefined,
  workspaceId: string,
): Promise<string | null> {
  if (!sourceId || sourceId === 'none') return null;
  const source = (
    await db
      .select({ id: file.id, workspaceId: file.workspaceId })
      .from(file)
      .where(eq(file.id, sourceId))
      .limit(1)
  ).at(0);
  return source?.workspaceId === workspaceId ? source.id : null;
}
