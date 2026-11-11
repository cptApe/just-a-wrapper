import type React from 'react';
import { dragSnapshot, subscribeDrag } from '../../lib/drag-store';

// Chromium composites native drag snapshots onto an opaque backdrop (white
// corner spikes on rounded tiles), so we suppress the snapshot and float an
// in-page clone of the dragged card instead — in-page compositing keeps the
// corners genuinely transparent.

let ghost: HTMLDivElement | null = null;
let teardown: (() => void) | null = null;
let blank: HTMLImageElement | null = null;

// A detached canvas is rejected as a drag image, which makes Chromium animate
// its default globe glyph from (0,0) to the cursor. A LOADED transparent
// image is accepted; keep one cached so it's ready by the first dragstart.
function blankDragImage(): HTMLImageElement {
  if (!blank) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    blank = new Image(1, 1);
    blank.src = c.toDataURL();
  }
  return blank;
}

// Warm the image on module load so it's decoded before the first dragstart.
if (typeof window !== 'undefined') blankDragImage();

function hideDragGhost(): void {
  teardown?.();
  teardown = null;
  ghost?.remove();
  ghost = null;
}

/**
 * Replace the native drag image with a clone of the dragged card. Call from
 * onDragStart after writing the drag payload; cleans itself up on drop or
 * dragend. `count` > 1 adds a badge for multi-item drags.
 */
export function showDragGhost(e: React.DragEvent<Element>, count: number): void {
  hideDragGhost();

  const source = e.currentTarget.closest('li') ?? e.currentTarget;
  const rect = source.getBoundingClientRect();

  e.dataTransfer.setDragImage(blankDragImage(), 0, 0);

  const clone = source.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  // Set list-style:none explicitly on the cloned li because it sits outside
  // the ul that normally provides the style.
  clone.style.listStyle = 'none';

  ghost = document.createElement('div');
  ghost.className = 'pointer-events-none fixed left-0 top-0 z-toast opacity-90';
  ghost.appendChild(clone);

  if (count > 1) {
    const badge = document.createElement('span');
    badge.className =
      'absolute -right-1.5 -top-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-meta font-medium text-background';
    badge.textContent = String(count);
    ghost.appendChild(badge);
  }

  // Keep the grab point fixed relative to the card, like a real drag.
  const grabX = e.clientX - rect.left;
  const grabY = e.clientY - rect.top;
  const position = (x: number, y: number) => {
    if (ghost) ghost.style.transform = `translate(${x - grabX}px, ${y - grabY}px)`;
  };
  position(e.clientX, e.clientY);

  const move = (ev: DragEvent) => position(ev.clientX, ev.clientY);
  const end = () => hideDragGhost();
  window.addEventListener('dragover', move);
  window.addEventListener('drop', end);
  window.addEventListener('dragend', end);
  const unsubscribe = subscribeDrag(() => {
    if (dragSnapshot().kind === 'idle') hideDragGhost();
  });
  teardown = () => {
    unsubscribe();
    window.removeEventListener('dragover', move);
    window.removeEventListener('drop', end);
    window.removeEventListener('dragend', end);
  };

  document.body.appendChild(ghost);
}
