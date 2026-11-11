import type { FileMetadata } from '@anthropic-ai/sdk/resources/beta/files';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { shipLog } from '@/lib/logger';
import 'server-only';
import { ARTIFACT_FILE_BETAS } from '../constants';
import { artifactSweepReducer, initialArtifactSweep } from '../lib/artifact-sweep-machine';
import { mirrorArtifacts } from './artifact-transitions';

// Mirror session output files into artifact rows idempotently by upstream file id.
// Missing keys or unknown sessions are logged no-ops for webhook safety.
// Settle sweeps poll even non-empty listings because indexing is delayed per file.
// Stop after two stable non-empty listings, bounded by the caller’s polling profile.
// Client refresh uses one listing; webhook and relay settling allow longer polls.
export type SweepProfile = 'single' | 'webhook-settle' | 'relay-settle';

const POLL_DELAYS_MS: Record<SweepProfile, number[]> = {
  single: [0],
  'webhook-settle': [0, 2000, 4000],
  'relay-settle': [0, 2000, 3000, 5000, 10000, 15000],
};

export type SweepResult = { swept: number; inserted: number };

export async function sweepSessionArtifacts(input: {
  anthropicSessionId: string;
  profile: SweepProfile;
}): Promise<SweepResult> {
  const client = getAnthropicClient();
  if (!client) {
    shipLog({
      level: 'warn',
      msg: 'artifact.sweep.skipped',
      feature: 'artifacts',
      op: 'sweep',
      reason: 'no_anthropic_key',
      session_id: input.anthropicSessionId,
    });
    return { swept: 0, inserted: 0 };
  }

  const row = (
    await db
      .select({ id: session.id, workspaceId: session.workspaceId })
      .from(session)
      .where(eq(session.anthropicSessionId, input.anthropicSessionId))
      .limit(1)
  ).at(0);
  if (!row) {
    // A session we never created (Console experiments, other tenants' webhooks).
    shipLog({
      msg: 'artifact.sweep.unknown_session',
      feature: 'artifacts',
      op: 'sweep',
      session_id: input.anthropicSessionId,
    });
    return { swept: 0, inserted: 0 };
  }

  let state = initialArtifactSweep;
  for (const waitMs of POLL_DELAYS_MS[input.profile]) {
    if (waitMs > 0) await delay(waitMs);
    const files = await listScopedFiles(client, input.anthropicSessionId);
    const inserted = await mirrorArtifacts(
      { workspaceId: row.workspaceId, sessionId: row.id },
      files,
    );
    state = artifactSweepReducer(state, { ids: files.map((meta) => meta.id), inserted });
    if (state.kind === 'settled') break;
  }
  const insertedTotal = state.inserted;
  const seen = state.seen;

  if (insertedTotal > 0) {
    shipLog({
      msg: 'artifact.sweep.discovered',
      feature: 'artifacts',
      op: 'sweep',
      session_id: input.anthropicSessionId,
      listed: seen.size,
      inserted: insertedTotal,
    });
  }
  return { swept: seen.size, inserted: insertedTotal };
}

type AnthropicClient = NonNullable<ReturnType<typeof getAnthropicClient>>;

async function listScopedFiles(
  client: AnthropicClient,
  anthropicSessionId: string,
): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];
  for await (const meta of client.beta.files.list({
    scope_id: anthropicSessionId,
    betas: ARTIFACT_FILE_BETAS,
  })) {
    files.push(meta);
  }
  return files;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
