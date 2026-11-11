// Zoom math for the PDF preview. The page column is laid out at `zoom` times
// the viewport width and the viewport scrolls; these helpers keep the point
// under the pointer fixed while the column grows or shrinks.

const MIN_PDF_ZOOM = 1;
const MAX_PDF_ZOOM = 4;
export const PDF_ZOOM_STEP = 1.25;

export function clampPdfZoom(zoom: number): number {
  return Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, zoom));
}

/**
 * Scroll offsets that keep the content under `pointer` (viewport coordinates)
 * in place after the column scales by `ratio` (next zoom / current zoom).
 */
export function scrollForPdfZoom(args: {
  scrollLeft: number;
  scrollTop: number;
  pointer: { x: number; y: number };
  ratio: number;
}): { scrollLeft: number; scrollTop: number } {
  const contentX = args.scrollLeft + args.pointer.x;
  const contentY = args.scrollTop + args.pointer.y;
  return {
    scrollLeft: Math.max(0, contentX * args.ratio - args.pointer.x),
    scrollTop: Math.max(0, contentY * args.ratio - args.pointer.y),
  };
}
