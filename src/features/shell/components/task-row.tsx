'use client';
import Link from 'next/link';
import { type DragEvent, useState } from 'react';
import { IconAlertCircle, IconPin02, IconUsers01 } from '@/components/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CountBadge } from '@/components/ui/count-badge';
import type { WorkspaceSessionListItem } from '@/features/sessions';
import { usePointerCoarse } from '@/hooks/use-pointer-coarse';
import { initialsFrom } from '@/lib/initials';
import { cn } from '@/lib/utils';
import type { TaskListActions } from '../hooks/use-task-list';
import { TaskRowMenu } from './task-row-menu';
import { TaskTitleMarquee } from './task-title-marquee';

/** The right-slot live status glyph. Null = no glyph (name takes full width).
    A plain helper (not a component) so the row can branch on null for layout. */
function statusGlyph(task: WorkspaceSessionListItem, active: boolean): React.ReactNode {
  switch (task.status) {
    case 'running':
    case 'rescheduling':
      return (
        <span title="Running" className="flex size-[18px] items-center justify-center">
          {/* Quiet track with a spinning blue quarter. */}
          <span
            aria-hidden
            className="size-[18px] animate-spin rounded-full border-2 border-alpha-12 border-t-info-strong"
          />
          <span className="sr-only">Running</span>
        </span>
      );
    case 'requires_input':
    case 'paused_no_credits':
      return (
        <span title="Requires your input" className="flex size-[18px] items-center justify-center">
          {/* Dotted status circle rendered inline for this task state. */}
          <svg
            aria-hidden
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            className="text-warning-strong"
          >
            <circle
              cx="8"
              cy="8"
              r="6.5"
              stroke="currentColor"
              strokeDasharray="2.44 1.62"
              strokeWidth="1.5"
            />
          </svg>
          <span className="sr-only">Requires your input</span>
        </span>
      );
    case 'terminated':
      return (
        <span title="Task failed" className="flex size-4 items-center justify-center">
          <IconAlertCircle className="size-4 text-destructive" />
          <span className="sr-only">Task failed</span>
        </span>
      );
    default:
      // Unread count only when the viewer is NOT already on the task.
      if (task.unread && !active) {
        return (
          <span title="Unseen messages" className="flex items-center justify-center">
            {/* Tasks track unread state, not per-message counts. */}
            <CountBadge count={1} aria-hidden className="size-[18px] min-w-[18px]" />
            <span className="sr-only">Unseen messages</span>
          </span>
        );
      }
      return null;
  }
}

// The row's clickable link body: pin marker, truncated title, and an optional
// inline marker (the own-shared glyph or a teammate's avatar) tucked right of the
// title, before the trailing status slot. `reserveSlot` pads the right so the
// title never runs under the absolutely-positioned status/menu box.
function TaskRowLink({
  task,
  active,
  onNavigate,
  reserveSlot,
  hoverReserve = false,
  showPin = true,
  inlineMarker,
  onDragStart,
  onDragEnd,
}: {
  task: WorkspaceSessionListItem;
  active: boolean;
  onNavigate?: () => void;
  /** Reserve the trailing slot now (a status glyph or open menu occupies it). */
  reserveSlot: boolean;
  /** Also reserve it on hover/focus — for rows whose ⋯ menu appears then. */
  hoverReserve?: boolean;
  /** Show the per-row pin marker. False for Team rows: `favoritedAt` is a global
   *  column, so a teammate's pin would otherwise imply the viewer pinned it. */
  showPin?: boolean;
  inlineMarker?: React.ReactNode;
  onDragStart?: (event: DragEvent<HTMLAnchorElement>) => void;
  onDragEnd?: () => void;
}) {
  const title = task.title || 'Untitled';
  return (
    <Link
      href={`/app/task/${task.id}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={title}
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'flex h-10 items-center rounded-md px-2.5 text-body',
        reserveSlot && 'pr-11',
        // pointer-coarse: the ⋯ menu is always visible on touch (no hover), so
        // rows that reserve on hover must reserve unconditionally there or the
        // row would shift.
        hoverReserve && 'group-hover:pr-11 group-focus-within:pr-11 pointer-coarse:pr-11',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        // Active differs by COLOR + background only, never font-weight: a
        // weight change (font-medium) reflows the truncated text and shifts it
        // horizontally on every selection. Full-strength foreground
        // (vs the /80 rest) already reads as "darker/active".
        active
          ? 'bg-alpha-12 text-foreground'
          : 'text-foreground/80 hover:bg-alpha-6 hover:text-foreground',
      )}
    >
      {/* Subtle per-row pin marker: reinforces the pinned state at the row
          level (the section header groups them; this labels the row itself).
          Inherits the row's muted rest color, brightening with it on hover. */}
      {showPin && task.favoritedAt ? (
        <IconPin02 className="mr-1.5 size-3.5 shrink-0" aria-hidden />
      ) : null}
      <TaskTitleMarquee key={title} title={title} />
      {inlineMarker}
    </Link>
  );
}

export function TaskRow({
  task,
  active,
  shared,
  actions,
  onNavigate,
  onDragTask,
  onDragEnd,
}: {
  task: WorkspaceSessionListItem;
  active: boolean;
  /** The viewer shared this OWN task with the workspace — show the shared glyph. */
  shared: boolean;
  actions: TaskListActions;
  onNavigate?: () => void;
  onDragTask: (task: { id: string; favorited: boolean }) => void;
  onDragEnd: () => void;
}) {
  // Owned by the row (not TaskRowMenu) so it can reserve the ⋯ button's space
  // while the menu is open — the portaled menu breaks :focus-within.
  const [menuOpen, setMenuOpen] = useState(false);
  // Lazy-mount the Radix menu until first hover/focus so expanding a long
  // section only mounts plain links and stays smooth. On coarse (touch)
  // pointers there is no hover to trigger the mount and the kebab is the row's
  // ONLY way to reach its actions, so mount it up front there — otherwise the
  // pointer-coarse reveal (task-row-menu) has nothing to reveal and the
  // reserved pr-9 slot on status-less rows shows a phantom gap.
  const [menuMounted, setMenuMounted] = useState(false);
  const isCoarse = usePointerCoarse();
  const status = statusGlyph(task, active);
  // The ⋯ can appear on hover, so the slot is always reserved for own rows.
  return (
    <li
      className="group relative"
      onPointerEnter={() => setMenuMounted(true)}
      onFocus={() => setMenuMounted(true)}
    >
      <TaskRowLink
        task={task}
        active={active}
        onNavigate={onNavigate}
        reserveSlot={menuOpen || status !== null}
        hoverReserve
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          requestAnimationFrame(() =>
            onDragTask({ id: task.id, favorited: task.favoritedAt !== null }),
          );
        }}
        onDragEnd={onDragEnd}
        inlineMarker={
          shared ? (
            <span
              className="ml-1.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground"
              data-testid="task-row-shared"
            >
              <IconUsers01 className="size-3.5" aria-hidden />
              <span className="sr-only">Shared with your team</span>
            </span>
          ) : null
        }
      />
      {/* Status and menu occupy the same fixed trailing box. Hover, focus or open
       * state swaps the menu above the status without shifting either. */}
      <div className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center">
        {status !== null ? (
          <div
            data-testid="task-row-status"
            className={cn(
              'pointer-events-none absolute inset-0 flex items-center justify-center',
              'transition-opacity duration-150',
              // On coarse (touch) the status glyph stays visible — it's core
              // sidebar glanceability and the row's actions are reachable from
              // the thread header's task menu, so status wins the shared slot.
              'group-hover:opacity-0 group-focus-within:opacity-0',
              menuOpen && 'opacity-0',
            )}
          >
            {status}
          </div>
        ) : null}
        <div
          className={cn(
            'flex size-8 items-center justify-center',
            // With a status glyph present, keep the ⋯ invisible until it takes
            // over on hover/focus (opacity only — it must stay clickable).
            // With a status glyph present the ⋯ stays hidden until hover/focus —
            // on coarse (touch) it never reveals, ceding the slot to the status
            // glyph (actions remain reachable from the thread header task menu).
            // Rows with NO status show the ⋯ on coarse via task-row-menu's own
            // pointer-coarse reveal, since this wrapper isn't opacity-gated then.
            status !== null &&
              !menuOpen &&
              'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
        >
          {menuMounted || isCoarse ? (
            <TaskRowMenu task={task} actions={actions} open={menuOpen} onOpenChange={setMenuOpen} />
          ) : null}
        </div>
      </div>
    </li>
  );
}

// Team rows show creator and status without a menu because identity mutations are creator-only.
export function TeamTaskRow({
  task,
  active,
  onNavigate,
}: {
  task: WorkspaceSessionListItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const status = statusGlyph(task, active);
  const { name, email, image } = task.createdBy;
  return (
    <li className="group relative">
      <TaskRowLink
        task={task}
        active={active}
        onNavigate={onNavigate}
        reserveSlot={status !== null}
        showPin={false}
        inlineMarker={
          <Avatar className="ml-1.5 size-5 shrink-0" data-testid="task-row-creator">
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback className="text-meta" aria-hidden>
              {initialsFrom(name, email)}
            </AvatarFallback>
            {/* Announce the creator like the own-shared glyph announces sharing. */}
            <span className="sr-only">Shared by {name || email}</span>
          </Avatar>
        }
      />
      {status !== null ? (
        <div className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center">
          <div
            data-testid="task-row-status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            {status}
          </div>
        </div>
      ) : null}
    </li>
  );
}
