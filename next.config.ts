import { withPostHogConfig } from '@posthog/nextjs-config';
import type { NextConfig } from 'next';

// posthog-js posts to same-origin `/ingest/*`, which is rewritten to PostHog
// Cloud so ad blockers cannot drop it. Ingest and the static and array asset
// bundles live on different EU hosts, hence three rules, most specific first.
const POSTHOG_INGEST_HOST = 'https://eu.i.posthog.com';
const POSTHOG_ASSETS_HOST = 'https://eu-assets.i.posthog.com';

const nextConfig: NextConfig = {
  // App Router matches exact page.<extension> and route.<extension> filenames.
  pageExtensions: [
    ...(process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES === 'true' ? ['dev.tsx', 'dev.ts'] : []),
    'tsx',
    'ts',
    'jsx',
    'js',
  ],
  // Hide the on-screen Next.js dev indicator badge (route static/dynamic state +
  // build-activity spinner). Build and runtime errors are still surfaced.
  devIndicators: false,
  // playwright-core (the `browse_page` cloud-browsing ability) must not be
  // bundled — it's a server-only client that connects to a REMOTE Browserbase
  // browser over CDP. Let Node require it at runtime instead of tracing it.
  serverExternalPackages: ['playwright-core'],
  // pnpm's symlinked store hides sharp's native libraries from file tracing.
  outputFileTracingIncludes: {
    '/**/*': [
      './node_modules/.pnpm/@img+sharp-linux-x64@*/node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/**/*',
    ],
  },
  // PostHog's proxy recipe: don't let Next's trailing-slash normalization
  // redirect the ingest requests.
  skipTrailingSlashRedirect: true,
  // Emails and open tabs still hold the retired page. Next carries any query across.
  async redirects() {
    return [{ source: '/upgrade', destination: '/app', permanent: false }];
  },
  async rewrites() {
    return [
      { source: '/admin/:slug.md', destination: '/admin-markdown/:slug' },
      { source: '/ingest/static/:path*', destination: `${POSTHOG_ASSETS_HOST}/static/:path*` },
      { source: '/ingest/array/:path*', destination: `${POSTHOG_ASSETS_HOST}/array/:path*` },
      { source: '/ingest/:path*', destination: `${POSTHOG_INGEST_HOST}/:path*` },
    ];
  },
};

// Source-map upload for client + server bundles so PostHog Error Tracking shows
// original stack frames. This is the ONE place reading process.env directly:
// next.config is bootstrap/build config, evaluated before the validated `env`
// module is appropriate to import, and these are build-time-only credentials.
//
// `withPostHogConfig` requires a *personal* API key (POSTHOG_API_KEY) + numeric
// project id (POSTHOG_PROJECT_ID) — distinct from the runtime ingest token. When
// either is absent the wrap is skipped entirely, so production builds without
// the upload credentials (and every keyless build) pass unchanged.
const personalApiKey = process.env.POSTHOG_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';
// The wrapper stays on whenever the key exists, so a plugin incompatibility
// shows up in a local verify and not only on Vercel. Only the upload itself is
// opt-in: POSTHOG_UPLOAD_SOURCEMAPS=true is set on the Vercel project, never
// locally: a local build is never served, and building over a dev server's
// `.next` would upload its leftover chunks.
const uploadSourceMaps = process.env.POSTHOG_UPLOAD_SOURCEMAPS === 'true';
if (personalApiKey && projectId && !uploadSourceMaps) {
  // Said once in the build log, so a deploy whose stack traces come out
  // minified names its own cause instead of waiting for someone to notice.
  console.log('PostHog source-map upload is off: POSTHOG_UPLOAD_SOURCEMAPS is not true');
}

export default personalApiKey && projectId
  ? withPostHogConfig(nextConfig, {
      personalApiKey,
      projectId,
      host,
      sourcemaps: { enabled: uploadSourceMaps, deleteAfterUpload: true },
    })
  : nextConfig;
