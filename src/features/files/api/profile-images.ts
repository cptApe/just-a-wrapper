import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { member, organization, user, workspace } from '@/db/schema';
import { resolveCaller, resolveUser } from '@/lib/caller';
import { AppError, IntegrationError } from '@/lib/errors';
import { roleIsAtLeast } from '@/lib/workspace-role';
import {
  cleanupBlob,
  deleteBlob,
  inspectBlob,
  readBlobBytes,
  signedBlobUrl,
  writeBlob,
} from './blob-storage';

export const PROFILE_IMAGE_LIMIT = 5 * 1024 * 1024;
const profileKind = z.enum(['avatar', 'workspace-icon']);
export type ProfileKind = z.infer<typeof profileKind>;

async function profileOwner(request: Request, kind: ProfileKind): Promise<string> {
  if (kind === 'avatar') {
    return (await resolveUser(request.headers)).userId;
  }
  const actor = await resolveCaller(request.headers);
  if (!roleIsAtLeast(actor.role, 'admin'))
    throw new AppError('FORBIDDEN', 'Only workspace admins can change its icon.', {
      workspaceId: actor.workspaceId,
    });
  return actor.workspaceId;
}

function profilePrefix(kind: ProfileKind, ownerId: string): string {
  return `${kind === 'avatar' ? 'avatars' : 'workspace-icons'}/${ownerId}/`;
}

async function prepareProfileUpload(request: Request, kind: ProfileKind) {
  const ownerId = await profileOwner(request, kind);
  return { pathname: `${profilePrefix(kind, ownerId)}upload-${randomUUID()}` };
}

export async function authorizeProfileUpload(
  request: Request,
  kind: ProfileKind,
  pathname: string,
) {
  const ownerId = await profileOwner(request, kind);
  const prefix = profilePrefix(kind, ownerId);
  if (!pathname.startsWith(prefix) || !/^upload-[0-9a-f-]{36}$/.test(pathname.slice(prefix.length)))
    throw new AppError('FORBIDDEN', 'Profile upload belongs to another account.', { ownerId });
  return ownerId;
}

async function saveProfileImage(request: Request, kind: ProfileKind, pathname: string) {
  const ownerId = await authorizeProfileUpload(request, kind, pathname);
  try {
    const metadata = await inspectBlob(pathname);
    if (metadata.size > PROFILE_IMAGE_LIMIT)
      throw new AppError('VALIDATION_FAILED', 'Profile image exceeds the 5 MB limit.', { ownerId });
    const bytes = await readBlobBytes(pathname, PROFILE_IMAGE_LIMIT);
    const { default: sharp } = await import('sharp');
    const image = await sharp(bytes)
      .resize({ width: 512, height: 512, fit: 'cover', withoutEnlargement: true })
      .webp()
      .toBuffer();
    const hash = createHash('sha256').update(image).update(randomUUID()).digest('hex');
    await writeBlob(
      `${profilePrefix(kind, ownerId)}${hash}.webp`,
      new Uint8Array(image),
      'image/webp',
    );
    return {
      url: `/api/${kind === 'avatar' ? 'avatars' : 'workspace-icons'}/${encodeURIComponent(ownerId)}?v=${hash}`,
    };
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not save profile image.',
      { ownerId },
      { cause },
    );
  } finally {
    await cleanupBlob(pathname);
  }
}

export async function readProfileImage(
  request: Request,
  kind: ProfileKind,
  ownerId: string,
): Promise<Response> {
  const viewer = await resolveUser(request.headers);
  const memberships = db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, viewer.userId));
  let imageUrl: string | null;
  if (kind === 'avatar') {
    if (viewer.userId !== ownerId) {
      const shared = (
        await db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.userId, ownerId), inArray(member.organizationId, memberships)))
          .limit(1)
      ).at(0);
      if (!shared)
        throw new AppError('ARTIFACT_NOT_FOUND', 'Avatar is not available.', { ownerId });
    }
    const profile = (
      await db.select({ image: user.image }).from(user).where(eq(user.id, ownerId)).limit(1)
    ).at(0);
    imageUrl = profile?.image ?? null;
  } else {
    const profile = (
      await db
        .select({ image: organization.logo })
        .from(workspace)
        .innerJoin(organization, eq(organization.id, workspace.organizationId))
        .where(and(eq(workspace.id, ownerId), inArray(workspace.organizationId, memberships)))
        .limit(1)
    ).at(0);
    imageUrl = profile?.image ?? null;
  }
  const hash = imageUrl
    ? new URL(imageUrl, 'https://profiles.invalid').searchParams.get('v')
    : null;
  if (!hash || !/^[0-9a-f]{64}$/.test(hash))
    throw new AppError('ARTIFACT_NOT_FOUND', 'Profile image is not available.', { ownerId });
  const location = await signedBlobUrl(`${profilePrefix(kind, ownerId)}${hash}.webp`);
  return new Response(null, {
    status: 307,
    headers: { location, 'cache-control': 'private, max-age=240' },
  });
}

async function cleanupPreviousProfileImage(
  request: Request,
  kind: ProfileKind,
  previousUrl: string,
) {
  const ownerId = await profileOwner(request, kind);
  const prefix = `/api/${kind === 'avatar' ? 'avatars' : 'workspace-icons'}/${encodeURIComponent(ownerId)}?v=`;
  if (!previousUrl.startsWith(prefix)) return;
  const hash = previousUrl.slice(prefix.length);
  if (!/^[0-9a-f]{64}$/.test(hash)) return;
  const current =
    kind === 'avatar'
      ? (await db.select({ image: user.image }).from(user).where(eq(user.id, ownerId))).at(0)
      : (
          await db
            .select({ image: organization.logo })
            .from(workspace)
            .innerJoin(organization, eq(organization.id, workspace.organizationId))
            .where(eq(workspace.id, ownerId))
        ).at(0);
  // A failed or concurrent replacement must not delete the image still in use.
  if (!current || current.image === previousUrl) return;
  await deleteBlob(`${profilePrefix(kind, ownerId)}${hash}.webp`);
}

export const profileImageBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), kind: profileKind }),
  z.object({ action: z.literal('cleanup'), kind: profileKind, previousUrl: z.string() }),
  z.object({ action: z.literal('save'), kind: profileKind, pathname: z.string().min(1) }),
]);

export async function processProfileImage(
  request: Request,
  body: z.infer<typeof profileImageBody>,
) {
  switch (body.action) {
    case 'prepare':
      return prepareProfileUpload(request, body.kind);
    case 'save':
      return saveProfileImage(request, body.kind, body.pathname);
    case 'cleanup':
      await cleanupPreviousProfileImage(request, body.kind, body.previousUrl);
      return { cleaned: true };
  }
}
