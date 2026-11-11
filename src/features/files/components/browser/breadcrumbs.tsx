'use client';

import * as React from 'react';
import { IconChevronRight } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useLibraryDragActive } from '../../hooks/use-library-drag-active';
import { useSpringLoad } from '../../hooks/use-spring-load';
import { dragCarriesItems, leftDropTarget, readDragKeys } from './types';

// Breadcrumbs support both navigation and dropping moved items.
// Dwelling mid-drag opens an ancestor without dropping; visible drag targets
// help users choose a destination. Resting hit areas stay larger than their text.

export function BrowserBreadcrumbs({
  crumbs,
  onNavigate,
  onDropMove,
}: {
  crumbs: Array<{ name: string; path: string }>;
  onNavigate: (path: string) => void;
  onDropMove?: (keys: string[], targetPath: string) => void;
}) {
  const dragActive = useLibraryDragActive();
  return (
    <nav className="flex flex-wrap items-center gap-1 text-meta" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.path} className="flex items-center gap-1">
          {i > 0 && <IconChevronRight className="size-3.5 text-foreground-tertiary" aria-hidden />}
          <Crumb
            name={c.name}
            path={c.path}
            current={i === crumbs.length - 1}
            dragActive={dragActive}
            onNavigate={onNavigate}
            onDropMove={onDropMove}
          />
        </span>
      ))}
    </nav>
  );
}

function Crumb({
  name,
  path,
  current,
  dragActive,
  onNavigate,
  onDropMove,
}: {
  name: string;
  path: string;
  current: boolean;
  dragActive: boolean;
  onNavigate: (path: string) => void;
  onDropMove?: (keys: string[], targetPath: string) => void;
}) {
  const [dropActive, setDropActive] = React.useState(false);
  const spring = useSpringLoad(() => {
    setDropActive(false);
    onNavigate(path);
  });
  return (
    <button
      type="button"
      onClick={() => onNavigate(path)}
      aria-current={current ? 'page' : undefined}
      {...(!current
        ? {
            // The current crumb neither accepts drops nor spring-loads — it is
            // already the open view.
            onDragOver: (e: React.DragEvent) => {
              if (!dragCarriesItems(e.dataTransfer)) return;
              spring.arm();
              if (!onDropMove) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropActive(true);
            },
            onDragLeave: (e: React.DragEvent<HTMLElement>) => {
              if (leftDropTarget(e)) {
                spring.disarm();
                setDropActive(false);
              }
            },
            ...(onDropMove
              ? {
                  onDrop: (e: React.DragEvent) => {
                    e.preventDefault();
                    spring.disarm();
                    setDropActive(false);
                    const keys = readDragKeys(e.dataTransfer);
                    if (keys.length > 0) onDropMove(keys, path);
                  },
                }
              : {}),
          }
        : {})}
      className={cn(
        // Padding pulled back with negative margin gives a larger hit target
        // without moving the resting layout.
        'rounded-full p-2 -mx-1.5 -my-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        current ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
        // Drop affordances are instant (no transitions) and step up: landing
        // zone while any library drag is in flight → hovered → armed (about to
        // spring open). The current crumb is not a target and stays calm.
        spring.armed
          ? 'bg-alpha-12 text-foreground'
          : dropActive
            ? 'bg-alpha-8 text-foreground'
            : dragActive && !current && 'bg-alpha-6',
      )}
    >
      {name}
    </button>
  );
}
