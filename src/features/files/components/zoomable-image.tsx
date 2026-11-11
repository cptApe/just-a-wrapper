'use client';

import { type ReactNode, useEffect, useEffectEvent, useId, useReducer, useRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { formatPercent } from '@/lib/format/format-number';
import { imagePreviewReducer, initialImagePreview } from '../lib/image-preview-machine';

const FIT = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
const WHEEL_SENSITIVITY = 0.01;
const LINE_PIXELS = 16;

type Transform = typeof FIT;
type Point = { x: number; y: number };
type Bounds = { width: number; height: number; imageWidth: number; imageHeight: number };

function clampImageScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(1, scale));
}

function clampImagePan(transform: Transform, bounds: Bounds): Transform {
  const scale = clampImageScale(transform.scale);
  if (scale === 1) return FIT;
  const maxX = Math.max(0, (bounds.imageWidth * scale - bounds.width) / 2);
  const maxY = Math.max(0, (bounds.imageHeight * scale - bounds.height) / 2);
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, transform.x)),
    y: Math.min(maxY, Math.max(-maxY, transform.y)),
  };
}

/** Coordinates are relative to the center of the fitted image. */
function zoomImageAtPoint(transform: Transform, scale: number, point: Point, bounds: Bounds) {
  const nextScale = clampImageScale(scale);
  const ratio = nextScale / transform.scale;
  return clampImagePan(
    {
      scale: nextScale,
      x: point.x - (point.x - transform.x) * ratio,
      y: point.y - (point.y - transform.y) * ratio,
    },
    bounds,
  );
}

export function ZoomableImage({
  src,
  alt,
  fallback,
}: {
  src: string;
  alt: string;
  fallback: ReactNode;
}) {
  const instructionsId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const boundsRef = useRef<Bounds>({ width: 0, height: 0, imageWidth: 0, imageHeight: 0 });
  const [state, dispatch] = useReducer(imagePreviewReducer, initialImagePreview);
  const { transform, status, animate } = state;
  const dragging = state.gesture.kind === 'drag';
  function apply(next: Transform, animated = false) {
    dispatch({ type: 'transform', transform: next, animate: animated });
  }
  const currentTransform = useEffectEvent(() => transform);

  useEffect(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image) return;

    function measure() {
      if (!container || !image) return;
      // offset dimensions exclude transforms; only read them on load/resize.
      boundsRef.current = {
        width: container.clientWidth,
        height: container.clientHeight,
        imageWidth: image.offsetWidth,
        imageHeight: image.offsetHeight,
      };
      apply(clampImagePan(currentTransform(), boundsRef.current));
    }
    function wheel(event: WheelEvent) {
      const zoom = event.ctrlKey || event.metaKey;
      if (!zoom && currentTransform().scale === 1) return;
      event.preventDefault();
      event.stopPropagation();
      if (!image?.naturalWidth || !container) return;
      const multiplier =
        event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? boundsRef.current.height : 1;
      if (zoom) {
        const rect = container.getBoundingClientRect();
        apply(
          zoomImageAtPoint(
            currentTransform(),
            currentTransform().scale * Math.exp(-event.deltaY * multiplier * WHEEL_SENSITIVITY),
            {
              x: event.clientX - rect.left - rect.width / 2,
              y: event.clientY - rect.top - rect.height / 2,
            },
            boundsRef.current,
          ),
        );
      } else {
        apply(
          clampImagePan(
            {
              ...currentTransform(),
              x: currentTransform().x - event.deltaX * multiplier,
              y: currentTransform().y - event.deltaY * multiplier,
            },
            boundsRef.current,
          ),
        );
      }
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(image);
    image.addEventListener('load', measure);
    container.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      image.removeEventListener('load', measure);
      container.removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`Image preview: ${alt}`}
      aria-describedby={instructionsId}
      aria-busy={status === 'loading'}
      tabIndex={0}
      className="relative flex h-full min-h-0 w-full grow basis-0 touch-none select-none items-center justify-center overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ cursor: transform.scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      onDoubleClick={(event) => {
        if (status !== 'ready') return;
        const rect = event.currentTarget.getBoundingClientRect();
        apply(
          zoomImageAtPoint(
            transform,
            transform.scale > 1 ? 1 : 2,
            {
              x: event.clientX - rect.left - rect.width / 2,
              y: event.clientY - rect.top - rect.height / 2,
            },
            boundsRef.current,
          ),
          true,
        );
      }}
      onKeyDown={(event) => {
        if (status !== 'ready' || event.metaKey || event.ctrlKey || event.altKey) return;
        const current = transform;
        const scale =
          event.key === '0'
            ? 1
            : event.key === '+' || event.key === '='
              ? current.scale * ZOOM_STEP
              : event.key === '-'
                ? current.scale / ZOOM_STEP
                : null;
        if (scale === null) return;
        event.preventDefault();
        event.stopPropagation();
        apply(zoomImageAtPoint(current, scale, { x: 0, y: 0 }, boundsRef.current), true);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.focus({ preventScroll: true });
        if (transform.scale === 1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatch({ type: 'drag', pointerId: event.pointerId, x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        const drag = state.gesture;
        if (drag.kind !== 'drag' || drag.pointerId !== event.pointerId) return;
        apply(
          clampImagePan(
            {
              ...transform,
              x: transform.x + event.clientX - drag.x,
              y: transform.y + event.clientY - drag.y,
            },
            boundsRef.current,
          ),
        );
        dispatch({ type: 'drag', pointerId: event.pointerId, x: event.clientX, y: event.clientY });
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        dispatch({ type: 'release' });
      }}
      onPointerCancel={() => {
        dispatch({ type: 'release' });
      }}
    >
      <span id={instructionsId} className="sr-only">
        Pinch to zoom. Scroll or drag to pan when zoomed. Double-click to toggle fit and 200%. Use
        plus and minus to zoom, or 0 to reset.
      </span>
      {/* Authenticated image bytes must bypass Next's unauthenticated optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- direct authenticated or CDN image bytes */}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => dispatch({ type: 'loaded' })}
        onError={() => dispatch({ type: 'failed' })}
        className={`max-h-full max-w-full shrink-0 rounded-lg object-contain ${animate ? 'transition-transform duration-150 ease-out motion-reduce:transition-none' : 'transition-none'}`}
        style={{
          visibility: status === 'ready' ? 'visible' : 'hidden',
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          willChange: 'transform',
        }}
      />
      {status === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" aria-label={`Loading ${alt}`} />
        </div>
      ) : null}
      {status === 'error' ? <div className="absolute inset-0">{fallback}</div> : null}
      {status === 'ready' && transform.scale > 1 ? (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-sm bg-background/90 px-2 py-1 text-meta font-normal tabular-nums text-muted-foreground">
          {formatPercent(transform.scale * 100, 0)}
        </span>
      ) : null}
    </div>
  );
}
