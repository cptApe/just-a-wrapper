/* eslint-disable just-a-wrapper/no-raw-color-literals -- ImageResponse has no CSS variable context; match the root brand OG image palette. */

import { ImageResponse } from 'next/og';
import { LOGO_MARK_PATH } from '@/components/brand/logo';
import { resolveSessionShare } from '@/features/chat/api/resolve-share';
import { resolveShare } from '@/features/files/server';
import { brand } from '@/lib/brand/identity';
import { withRequestContext } from '@/lib/request-context';

export const alt = `Shared link from ${brand.name}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Recheck liveness on every image request, including after a link is revoked.
export const dynamic = 'force-dynamic';

export default async function ShareImage({ params }: { params: Promise<{ token: string }> }) {
  return withRequestContext({ route: 'share-opengraph-image' }, async () => {
    const { token } = await params;
    const folder = await resolveShare(token);
    const share = folder.status === 'not_found' ? await resolveSessionShare(token) : folder;
    const title =
      share.status === 'live'
        ? 'file' in share
          ? share.file.filename
          : 'folderPath' in share
            ? share.folderPath.split('/').filter(Boolean).at(-1) || 'Files'
            : share.title
        : share.status === 'not_found'
          ? 'Link not found'
          : share.status === 'unavailable'
            ? 'Temporarily unavailable'
            : 'Link expired';

    return new ImageResponse(
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          padding: 72,
          background: '#0e0f0c',
          color: '#ffffff',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{ alignItems: 'center', color: '#a3a3a3', display: 'flex', fontSize: 26, gap: 12 }}
        >
          <svg width={34} height={34} viewBox="0 0 64 64" fill="#a3a3a3">
            <path d={LOGO_MARK_PATH} />
          </svg>
          {brand.name}
        </div>
        <div
          style={{
            display: 'block',
            fontSize: 72,
            fontWeight: 600,
            letterSpacing: '-0.04em',
            lineHeight: 1.15,
            lineClamp: 2,
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: 'block',
            fontSize: 28,
            color: '#a3a3a3',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
          }}
        >
          {share.status === 'live' ? share.workspaceName : 'This shared link is not available.'}
        </div>
      </div>,
      { ...size, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  });
}
