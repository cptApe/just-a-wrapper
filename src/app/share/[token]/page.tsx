import type { Metadata } from 'next';
import { IconFolderX } from '@/components/icons';
import { resolveSessionShare } from '@/features/chat/api/resolve-share';
import { ShareTranscriptView } from '@/features/chat/components/share-transcript-view';
import { ShareFileView, ShareView } from '@/features/files';
import { resolveShare, uploadConfig } from '@/features/files/server';
import { brand } from '@/lib/brand/identity';
import { withRequestContext } from '@/lib/request-context';

// Resolve public share tokens as folders first, then sessions on not-found.
// Each feature owns access resolution; expired, revoked and unknown tokens
// show a notice without exposing content.

export const dynamic = 'force-dynamic';

async function resolveToken(token: string) {
  return withRequestContext({ route: 'share-page' }, async () => {
    const folder = await resolveShare(token);
    if (folder.status !== 'not_found') return { kind: 'folder' as const, folder };
    const session = await resolveSessionShare(token);
    return { kind: 'session' as const, session };
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const resolved = await resolveToken(token);
  const share = resolved.kind === 'folder' ? resolved.folder : resolved.session;
  const title =
    share.status === 'live'
      ? `${'file' in share ? share.file.filename : 'folderPath' in share ? share.folderPath.split('/').filter(Boolean).at(-1) || 'Files' : share.title} · ${share.workspaceName}`
      : share.status === 'not_found'
        ? 'Link not found'
        : share.status === 'unavailable'
          ? 'Temporarily unavailable'
          : 'Link expired';
  const description =
    share.status === 'live'
      ? `${'file' in share ? 'A file' : 'folderPath' in share ? 'Files' : 'A task'} shared from ${brand.name}.`
      : 'This shared link is not available.';
  const images = [
    {
      url: `/share/${encodeURIComponent(token)}/opengraph-image`,
      width: 1200,
      height: 630,
      alt: title,
    },
  ];
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website', images },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}

function NoticePage({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="inline-flex size-11 items-center justify-center rounded-full bg-alpha-6 text-muted-foreground">
        <IconFolderX className="size-5" />
      </div>
      <h1 className="text-body-lg font-semibold">{title}</h1>
      <p className="max-w-sm text-meta text-muted-foreground">{message}</p>
    </main>
  );
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveToken(token);

  if (resolved.kind === 'folder') {
    const folder = resolved.folder;
    if (folder.status === 'revoked') {
      return (
        <NoticePage
          title="Link revoked"
          message="The owner has revoked this share link. Ask them for a new one if you still need access."
        />
      );
    }
    if (folder.status === 'expired') {
      return (
        <NoticePage
          title="Link expired"
          message="This share link has expired. Ask the owner for a new link."
        />
      );
    }
    // Narrowed to the folder 'live' state (not_found was excluded above).
    if (folder.status === 'live') {
      if (folder.kind === 'file')
        return (
          <ShareFileView
            workspaceId={folder.workspaceId}
            workspaceName={folder.workspaceName}
            file={folder.file}
          />
        );
      return (
        <ShareView
          workspaceName={folder.workspaceName}
          workspaceId={folder.workspaceId}
          folderPath={folder.folderPath}
          mode={folder.mode}
          files={folder.files}
          token={token}
          uploadConfig={
            folder.mode === 'edit'
              ? await uploadConfig(token)
              : { enabled: false, reason: 'This share is read-only.' }
          }
        />
      );
    }
  }

  if (resolved.kind === 'session') {
    const session = resolved.session;
    if (session.status === 'revoked') {
      return (
        <NoticePage
          title="Link revoked"
          message="The owner has turned off sharing for this task. Ask them for a new link if you still need access."
        />
      );
    }
    if (session.status === 'expired') {
      return (
        <NoticePage
          title="Link expired"
          message="This share link has expired. Ask the owner for a new link."
        />
      );
    }
    if (session.status === 'unavailable') {
      return (
        <NoticePage
          title="Temporarily unavailable"
          message="This shared task could not be loaded right now. Try again in a moment."
        />
      );
    }
    if (session.status === 'live') {
      return (
        <ShareTranscriptView
          workspaceName={session.workspaceName}
          title={session.title}
          items={session.items}
        />
      );
    }
  }

  return (
    <NoticePage
      title="Link not found"
      message="This share link is invalid. Check the URL, or ask the owner for a new link."
    />
  );
}
