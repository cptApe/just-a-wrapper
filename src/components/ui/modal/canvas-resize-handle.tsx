'use client';
import { cn } from '@/lib/utils';
export function CanvasResizeHandle({
  resizing,
  width,
  minWidth,
  maxWidth,
  rightInset,
  onResizingChange,
  onWidthChange,
}: {
  resizing: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  /** Gap between the panel's right edge and the viewport (0 = edge-touching,
      12 = the floating card) — the drag math must subtract it or the panel
      jumps by that amount on grab. */
  rightInset: number;
  onResizingChange: (resizing: boolean) => void;
  onWidthChange: (apply: (width: number) => number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onResizingChange(true);
      }}
      onPointerMove={(e) => {
        if (!resizing) return;
        const next = window.innerWidth - rightInset - e.clientX;
        onWidthChange(() => next);
      }}
      onPointerUp={(e) => {
        if (!resizing) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onResizingChange(false);
      }}
      onLostPointerCapture={() => onResizingChange(false)}
      onPointerCancel={(e) => {
        if (!resizing) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onResizingChange(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        // The handle owns its arrows; don't let them reach list-navigation
        // listeners (PreviewSurface) on document.
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === 'ArrowLeft' ? 32 : -32;
        onWidthChange((w) => w + delta);
      }}
      className={cn(
        'group absolute inset-y-0 left-0 z-10 flex w-3 cursor-ew-resize items-center justify-center',
        'touch-none focus-visible:outline-none',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-10 w-1 rounded-full bg-alpha-12 opacity-0',
          'transition-opacity duration-150 ease-[var(--ease-out)]',
          'group-hover:opacity-100 group-focus-visible:opacity-100',
          resizing && 'opacity-100',
        )}
      />
    </div>
  );
}
