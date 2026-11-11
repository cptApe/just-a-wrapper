'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/observability-client';

// Root global-error — the last-resort boundary that replaces the root layout
// when a render error escapes every closer error.tsx (or when the root layout
// itself throws). Because it replaces the layout, globals.css and the font
// pipeline are NOT loaded here: if the styling system is what broke, importing
// it would render this fallback broken too. So it is deliberately self-contained
// — its own <html>/<body>, inline layout, and a <style> block that carries the
// light/dark palette via prefers-color-scheme. The ONLY app import allowed is
// the client capture sink.
//
// Next 16.2 passes both `reset` (clear + re-render) and `unstable_retry`
// (re-fetch + re-render). Recovery uses `unstable_retry`: a transient data
// failure is only cleared by re-fetching — `reset` alone would re-throw at once.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: 'global-error' });
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* Self-contained styling: no globals.css, no design tokens — hardcoded
            values so this renders correctly even if the CSS pipeline is the
            failure. prefers-color-scheme mirrors the app's light/dark defaults. */}
        <style>{`
          .ge-root {
            min-height: 100dvh;
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 24px;
            text-align: center;
            background: #ffffff;
            color: #0a0a0a;
            font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          .ge-title { font-size: 16px; font-weight: 600; margin: 0; }
          .ge-body { font-size: 13px; line-height: 1.5; margin: 0; max-width: 420px; color: #6b6b6b; }
          .ge-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
          .ge-btn {
            appearance: none;
            border: 0;
            cursor: pointer;
            height: 36px;
            padding: 0 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 500;
            background: #0a0a0a;
            color: #ffffff;
          }
          .ge-btn:hover { opacity: 0.9; }
          .ge-link {
            font-size: 13px;
            color: #0a0a0a;
            text-decoration: underline;
            text-underline-offset: 2px;
          }
          @media (prefers-color-scheme: dark) {
            .ge-root { background: #0a0a0a; color: #fafafa; }
            .ge-body { color: #a1a1a1; }
            .ge-btn { background: #fafafa; color: #0a0a0a; }
            .ge-link { color: #fafafa; }
          }
        `}</style>
        <title>Something went wrong</title>
        <main className="ge-root">
          <p className="ge-title">Something went wrong</p>
          <p className="ge-body">The app hit an unexpected error. Try again, or head back home.</p>
          <div className="ge-actions">
            <button type="button" className="ge-btn" onClick={() => unstable_retry()}>
              Try again
            </button>
            {/* A real <a>, not next/link, on purpose: recovery from a last-resort
                error should be a full document load that re-boots the app from
                scratch — and Link's router context may be part of what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- recovery requires a full document reload without router context */}
            <a className="ge-link" href="/">
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
