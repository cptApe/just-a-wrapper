'use client';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Spinner } from '@/components/ui/spinner';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { toolQueryKeys } from '../api/keys';

// Copy for the inline replay player's non-success states.
/** Shown while the replay manifest is being fetched. */
const REPLAY_LOADING_TEXT = 'Loading the replay';

/** Shown when the session has no replay (too old, or it was never recorded). */
const REPLAY_UNAVAILABLE_TEXT = 'This replay is not available.';

/** Shown when the replay exists but could not be played back. */
const REPLAY_ERROR_TEXT = 'The replay could not be played.';

// The plain centered line the player shows when there is nothing to play (no
// owned session, no recording) or when playback failed. No spinner, no motion.
function ReplayMessage({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/85 px-4 text-center text-meta font-medium text-muted-foreground backdrop-blur-sm">
      {children}
    </div>
  );
}

// Decides whether there is anything to fetch. Without OUR owned session id (e.g.
// the dev board) the proxy can't authorize the replay, so there is nothing to
// load — show the plain "not available" line directly rather than run an effect
// that would only ever set that state. With a session id, the loader owns the
// fetch.
export function BrowserReplaySurface({
  sessionId,
  browserbaseSessionId,
}: {
  sessionId?: string;
  browserbaseSessionId: string;
}) {
  if (!sessionId) return <ReplayMessage>{REPLAY_UNAVAILABLE_TEXT}</ReplayMessage>;
  return <ReplayLoader sessionId={sessionId} browserbaseSessionId={browserbaseSessionId} />;
}

// Fetches the replay metadata through our proxy and drives the states the player
// can be in. Starts in `loading` (the initial state, so the effect only ever
// sets terminal states asynchronously) and resolves to the first recorded tab's
// player, the plain "unavailable" line, or the error line. The manifest is
// fetched via the same proxy (the pageId route) which hls.js loads directly;
// segment URLs inside are pre-signed CDN links the browser pulls without our key.
function ReplayLoader({
  sessionId,
  browserbaseSessionId,
}: {
  sessionId: string;
  browserbaseSessionId: string;
}) {
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const handleError = useCallback(() => setPlaybackFailed(true), []);
  const replay = useQuery({
    queryKey: toolQueryKeys.replay(sessionId, browserbaseSessionId),
    queryFn: async ({ signal }) => {
      const metadataUrl = `/api/sessions/${encodeURIComponent(sessionId)}/replays?bb=${encodeURIComponent(browserbaseSessionId)}`;
      const response = await fetch(metadataUrl, {
        headers: { accept: 'application/json' },
        signal,
      });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new AppError('API_REQUEST_FAILED', 'Replay metadata request failed', {
          status: response.status,
          sessionId,
        });
      return firstPageId(await response.json());
    },
  });
  useEffect(() => {
    if (replay.error) captureException(replay.error, { op: 'browse-replay-metadata', sessionId });
  }, [replay.error, sessionId]);

  if (replay.isPending) {
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-meta font-medium text-muted-foreground backdrop-blur-sm">
        <Spinner className="size-4" />
        {REPLAY_LOADING_TEXT}
      </div>
    );
  }
  if (replay.data && !playbackFailed) {
    const manifestUrl = `/api/sessions/${encodeURIComponent(sessionId)}/replays/${encodeURIComponent(replay.data)}?bb=${encodeURIComponent(browserbaseSessionId)}`;
    return <ReplayVideo manifestUrl={manifestUrl} onError={handleError} />;
  }
  return (
    <ReplayMessage>
      {replay.isError || playbackFailed ? REPLAY_ERROR_TEXT : REPLAY_UNAVAILABLE_TEXT}
    </ReplayMessage>
  );
}

// The HLS player. hls.js is dynamically imported so it never rides the main
// bundle; Safari plays HLS natively, so it takes the src directly and skips the
// library entirely. Playback never starts on its own — the user presses play on
// the native controls, which honors reduced-motion for free (no autoplay ever).
function ReplayVideo({ manifestUrl, onError }: { manifestUrl: string; onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Native HLS (Safari / iOS) — no library needed.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    const lifecycle = { cancelled: false };
    let hls: import('hls.js').default | null = null;
    void import('hls.js').then(
      ({ default: Hls }) => {
        const el = videoRef.current;
        if (lifecycle.cancelled || !el) return;
        if (!Hls.isSupported()) {
          onError();
          return;
        }
        hls = new Hls({ enableWorker: true });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) onError();
        });
        hls.loadSource(manifestUrl);
        hls.attachMedia(el);
      },
      (loadError) => {
        // The hls.js chunk failed to load — report and surface the plain error
        // line rather than a dead player.
        captureException(loadError, {
          feature: 'chat',
          op: 'browse-replay-hls-load',
        });
        if (!lifecycle.cancelled) onError();
      },
    );
    return () => {
      lifecycle.cancelled = true;
      if (hls) hls.destroy();
    };
  }, [manifestUrl, onError]);

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      className="absolute inset-0 size-full bg-media-bed object-contain"
      data-testid="browsed-page-replay"
    />
  );
}

/** The first recorded tab's page id from the replay-metadata response, read
 *  tolerantly — null means no replay to play. */
const replayMetadataSchema = z.object({ pages: z.array(z.unknown()) });
const replayPageSchema = z.object({ pageId: z.string().min(1) });
function firstPageId(value: unknown): string | null {
  const metadata = replayMetadataSchema.safeParse(value);
  if (!metadata.success) return null;
  const page = replayPageSchema.safeParse(metadata.data.pages.at(0));
  return page.success ? page.data.pageId : null;
}
