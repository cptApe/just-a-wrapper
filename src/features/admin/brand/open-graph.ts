// Mirrored from `src/app/opengraph-image.tsx`, which loads `next/og` at module
// scope, so stating the image size does not bundle the renderer.
export const OPEN_GRAPH_IMAGE = {
  /** Next's file convention serves the route at the segment path. */
  path: '/opengraph-image',
  source: 'src/app/opengraph-image.tsx',
  width: 1200,
  height: 630,
  contentType: 'image/png',
} as const;
