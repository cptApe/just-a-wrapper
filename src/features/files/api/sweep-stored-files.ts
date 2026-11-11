import 'server-only';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { file, organization, user, workspace } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { storedBlobState } from '../lib/stored-blob-machine';
import { deleteBlob, listStoredBlobs, storageEnabled } from './blob-storage';
import { purgeTrashRows } from './trash-transitions';

// Each prefix gets its own budget so workspace uploads cannot starve profile cleanup.
// The brake counts only candidates nothing in the database explains: the trash
// purge removes its own bytes by path, and a purged owner explains what it left.
const PREFIX_BUDGET_MS = 60_000;
const MAX_REMOVAL_SHARE = 0.5;
const MIN_REMOVAL_CANDIDATES = 100;

type StoredBlob = Awaited<ReturnType<typeof listStoredBlobs>>['blobs'][number];
export type StoredFilesReport = {
  expiredFiles: number;
  removedBlobs: number;
  listedBlobs: number;
  candidateBlobs: number;
  // Candidates whose owner was purged on purpose; they never trip the brake.
  explainedBlobs: number;
  failed: Array<{ pathname: string; error: string }>;
  incompletePrefixes: string[];
  aborted: boolean;
  sweepError: string | null;
};

async function referencedPaths(blobs: StoredBlob[], expiredIds: string[]): Promise<Set<string>> {
  const paths = blobs.map((blob) => blob.pathname);
  if (paths.length === 0) return new Set();
  const references = new Set<string>();
  const files = await db
    .select({ id: file.id, path: file.storagePath, thumbnail: file.thumbnailPath })
    .from(file)
    .where(or(inArray(file.storagePath, paths), inArray(file.thumbnailPath, paths)));
  const expired = new Set(expiredIds);
  for (const row of files) {
    if (expired.has(row.id)) continue;
    references.add(row.path);
    if (row.thumbnail !== null) references.add(row.thumbnail);
  }
  const profiles = blobs.flatMap(({ pathname }) => {
    const [kind, ownerId, filename] = pathname.split('/');
    if (
      !ownerId ||
      !filename ||
      filename.startsWith('upload-') ||
      (kind !== 'avatars' && kind !== 'workspace-icons')
    )
      return [];
    return [
      {
        pathname,
        kind,
        ownerId,
        url: `/api/${kind}/${encodeURIComponent(ownerId)}?v=${filename.replace(/\.webp$/, '')}`,
      },
    ];
  });
  if (profiles.length === 0) return references;
  const avatarOwners = profiles
    .filter((profile) => profile.kind === 'avatars')
    .map((profile) => profile.ownerId);
  const iconOwners = profiles
    .filter((profile) => profile.kind === 'workspace-icons')
    .map((profile) => profile.ownerId);
  const avatars = await db
    .select({ id: user.id, url: user.image })
    .from(user)
    .where(inArray(user.id, avatarOwners));
  const icons = await db
    .select({ id: workspace.id, url: organization.logo })
    .from(workspace)
    .innerJoin(organization, eq(workspace.organizationId, organization.id))
    .where(inArray(workspace.id, iconOwners));
  for (const profile of profiles) {
    const rows = profile.kind === 'avatars' ? avatars : icons;
    if (rows.some((row) => row.id === profile.ownerId && row.url === profile.url))
      references.add(profile.pathname);
  }
  return references;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Candidates whose owner row is gone: a workspace purge or an account purge
 * removed it on purpose, so its leftover bytes are an expected removal. Every
 * other unreferenced blob sits under a live owner and counts toward the brake.
 */
type BlobOwner = { pathname: string; table: 'workspace' | 'user'; ownerId: string };

function ownerOf(pathname: string): BlobOwner | null {
  const [kind, ownerId] = pathname.split('/');
  if (!ownerId || !pathname.slice(`${kind}/${ownerId}/`.length)) return null;
  if (kind === 'ws' || kind === 'workspace-icons')
    return UUID.test(ownerId) ? { pathname, table: 'workspace', ownerId } : null;
  if (kind === 'avatars') return { pathname, table: 'user', ownerId };
  return null;
}

async function explainedPaths(candidates: string[]): Promise<Set<string>> {
  const owners = candidates.flatMap((pathname): BlobOwner[] => {
    const owner = ownerOf(pathname);
    return owner ? [owner] : [];
  });
  const workspaceIds = [
    ...new Set(owners.filter((o) => o.table === 'workspace').map((o) => o.ownerId)),
  ];
  const userIds = [...new Set(owners.filter((o) => o.table === 'user').map((o) => o.ownerId))];
  const live = new Set<string>();
  for (let offset = 0; offset < workspaceIds.length; offset += 1000) {
    const rows = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(inArray(workspace.id, workspaceIds.slice(offset, offset + 1000)));
    for (const row of rows) live.add(`workspace:${row.id}`);
  }
  for (let offset = 0; offset < userIds.length; offset += 1000) {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, userIds.slice(offset, offset + 1000)));
    for (const row of rows) live.add(`user:${row.id}`);
  }
  return new Set(
    owners
      .filter((owner) => !live.has(`${owner.table}:${owner.ownerId}`))
      .map((owner) => owner.pathname),
  );
}

async function sweepPrefix({
  prefix,
  expiredIds,
  expiredPaths,
  now,
  dryRun,
  report,
}: {
  prefix: string;
  expiredIds: string[];
  expiredPaths: Set<string>;
  now: Date;
  dryRun: boolean;
  report: StoredFilesReport;
}): Promise<void> {
  const deadline = Date.now() + PREFIX_BUDGET_MS;
  const candidates: string[] = [];
  let listed = 0;
  let cursor: string | undefined;
  do {
    const page = await listStoredBlobs(prefix, cursor);
    listed += page.blobs.length;
    report.listedBlobs += page.blobs.length;
    const references = await referencedPaths(page.blobs, expiredIds);
    for (const blob of page.blobs) {
      if (storedBlobState(blob.uploadedAt, references.has(blob.pathname), now) === 'expired') {
        candidates.push(blob.pathname);
        report.candidateBlobs += 1;
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
    if (cursor !== undefined && Date.now() >= deadline) {
      report.incompletePrefixes.push(prefix);
      break;
    }
  } while (cursor !== undefined);
  const purged = await explainedPaths(candidates);
  const explained = candidates.filter((path) => expiredPaths.has(path) || purged.has(path)).length;
  report.explainedBlobs += explained;
  const unexplained = candidates.length - explained;
  // A pathname mismatch shows up as many unreferenced blobs under live owners; stop and report it.
  if (
    unexplained > MIN_REMOVAL_CANDIDATES &&
    unexplained > (listed - explained) * MAX_REMOVAL_SHARE
  ) {
    report.aborted = true;
    captureException(
      new AppError('UNEXPECTED', 'Stored file sweep exceeded its removal limit.', {
        prefix,
        candidates: candidates.length,
        unexplained,
        listed,
      }),
      { operation: 'stored-file-sweep-abort' },
    );
    return;
  }
  if (!dryRun) await removeCandidates(candidates, report);
}

async function removeCandidates(candidates: string[], report: StoredFilesReport): Promise<void> {
  for (let offset = 0; offset < candidates.length; offset += 1000) {
    const batch = candidates.slice(offset, offset + 1000);
    try {
      await deleteBlob(batch);
      report.removedBlobs += batch.length;
    } catch (cause) {
      // Failed removals remain unreferenced for the next sweep; other batches still run.
      // The provider error can contain filenames; keep its detail only in the report.
      captureException(
        new AppError('EXTERNAL_API_FAILED', 'Stored file deletion batch failed.', {
          count: batch.length,
        }),
        { operation: 'stored-file-sweep' },
      );
      for (const pathname of batch)
        report.failed.push({
          pathname,
          error: cause instanceof Error ? cause.message : String(cause),
        });
    }
  }
}

export async function sweepStoredFiles({
  dryRun,
}: {
  dryRun: boolean;
}): Promise<StoredFilesReport> {
  const now = new Date();
  const report: StoredFilesReport = {
    expiredFiles: 0,
    removedBlobs: 0,
    listedBlobs: 0,
    candidateBlobs: 0,
    explainedBlobs: 0,
    failed: [],
    incompletePrefixes: [],
    aborted: false,
    sweepError: null,
  };
  try {
    const { removed: expired, failed } = await purgeTrashRows(now, dryRun);
    report.failed.push(...failed);
    report.expiredFiles = expired.length;
    if (!storageEnabled()) return report;
    const expiredIds = expired.map((row) => row.id);
    const expiredPaths = new Set(
      expired.flatMap((row) =>
        row.thumbnailPath === null ? [row.storagePath] : [row.storagePath, row.thumbnailPath],
      ),
    );
    for (const prefix of ['ws/', 'avatars/', 'workspace-icons/']) {
      await sweepPrefix({ prefix, expiredIds, expiredPaths, now, dryRun, report });
      if (report.aborted) break;
    }
  } catch (cause) {
    // Retention results must survive a storage outage, including rows already purged.
    captureException(cause, { operation: 'stored-file-sweep' });
    report.sweepError = cause instanceof Error ? cause.message : String(cause);
  }
  return report;
}
