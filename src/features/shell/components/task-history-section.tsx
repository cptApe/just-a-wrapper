'use client';

import { IconChevronDown } from '@/components/icons';
import type { WorkspaceSessionListItem } from '@/features/sessions';
import { sessionRowKey } from '@/features/sessions/api/session-list-cache';
import { isPendingSessionId } from '@/features/sessions/api/use-create-session';
import { useLoadMoreSentinel } from '@/hooks/use-load-more-sentinel';
import { cn } from '@/lib/utils';
import { useSectionOpen } from '../hooks/use-section-open';
import type { TaskListActions } from '../hooks/use-task-list';
import { isSharedByViewer, TEAM_GROUP_LABEL } from '../lib/group-tasks';
import { TaskRow, TeamTaskRow } from './task-row';

export type DropZone = 'pinned' | 'recents';

// The shared collapsible section header — a toggle button whose chevron shows on
// hover when open and stays put as the affordance when collapsed.
function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'group flex h-8 shrink-0 items-center gap-0.5 rounded-md px-2.5 text-title-card font-semibold text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      )}
    >
      {label}
      <IconChevronDown
        className={cn(
          'relative top-px size-3.5 transition duration-150 ease-[cubic-bezier(0,0,0.2,1)]',
          !open && '-rotate-90',
          // Expanded: chevron on hover only. Collapsed: always shown as the affordance.
          open ? 'opacity-0 group-hover:opacity-100' : 'opacity-100',
        )}
        aria-hidden
      />
    </button>
  );
}

export function HistorySection({
  label,
  cookie,
  initialOpen,
  tasks,
  viewerId,
  actions,
  pathname,
  onNavigate,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  draggedTask,
  dropZone,
  dropTarget,
  onDropTargetChange,
  onDropTask,
  onDragTask,
  onDragEnd,
}: {
  label: string;
  cookie: string;
  initialOpen: boolean;
  tasks: WorkspaceSessionListItem[];
  viewerId: string;
  actions: TaskListActions;
  pathname: string;
  onNavigate?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  draggedTask: { id: string; favorited: boolean } | null;
  dropZone: DropZone;
  dropTarget: DropZone | null;
  onDropTargetChange: (dropZone: DropZone | null) => void;
  onDropTask: (dropZone: DropZone) => void;
  onDragTask: (task: { id: string; favorited: boolean }) => void;
  onDragEnd: () => void;
}) {
  const [open, toggleOpen] = useSectionOpen(cookie, initialOpen);
  const canDrop = draggedTask !== null && draggedTask.favorited !== (dropZone === 'pinned');
  const highlighted = canDrop && dropTarget === dropZone;
  const showDropPlaceholder = canDrop && tasks.length === 0;

  return (
    <section
      className={cn('flex flex-col rounded-md pt-3', highlighted && 'bg-alpha-6')}
      aria-label={label}
      onDragEnter={
        canDrop
          ? (event) => {
              event.preventDefault();
              onDropTargetChange(dropZone);
            }
          : undefined
      }
      onDragOver={
        canDrop
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              onDropTargetChange(dropZone);
            }
          : undefined
      }
      onDragLeave={
        canDrop
          ? (event) => {
              // Descendants emit dragleave while the pointer remains in this section.
              // Clear the highlight only after it actually crosses the section bounds.
              const bounds = event.currentTarget.getBoundingClientRect();
              const stillInside =
                event.clientX >= bounds.left &&
                event.clientX <= bounds.right &&
                event.clientY >= bounds.top &&
                event.clientY <= bounds.bottom;
              if (!stillInside) onDropTargetChange(null);
            }
          : undefined
      }
      onDrop={
        canDrop
          ? (event) => {
              event.preventDefault();
              onDropTask(dropZone);
            }
          : undefined
      }
    >
      <SectionHeader label={label} open={open} onToggle={toggleOpen} />

      {showDropPlaceholder ? (
        <p className="flex h-10 items-center rounded-md bg-alpha-3 px-2.5 text-title-card text-muted-foreground">
          {dropZone === 'pinned' ? 'Drop to pin' : 'Drop to unpin'}
        </p>
      ) : null}

      {open ? (
        tasks.length === 0 ? null : (
          <ul className="flex flex-col gap-0.5 pt-0.5">
            {tasks.map((task) => (
              <TaskRow
                key={sessionRowKey(task.id)}
                task={task}
                active={pathname === `/app/task/${task.id}` || isPendingSessionId(task.id)}
                shared={isSharedByViewer(task, viewerId)}
                actions={actions}
                onNavigate={onNavigate}
                onDragTask={onDragTask}
                onDragEnd={onDragEnd}
              />
            ))}
            {loadingMore ? <TaskRowSkeletons /> : null}
            {hasMore && !loadingMore && onLoadMore ? (
              <LoadMoreSentinel onLoadMore={onLoadMore} />
            ) : null}
          </ul>
        )
      ) : null}
    </section>
  );
}

// Teammates' shared tasks. Like Recents but each row shows the creator's
// avatar and has no ⋯ menu; no pagination (it rides the same list the other
// sections page in) and no empty row (the whole section is hidden when empty).
export function TeamSection({
  cookie,
  initialOpen,
  tasks,
  pathname,
  onNavigate,
}: {
  cookie: string;
  initialOpen: boolean;
  tasks: WorkspaceSessionListItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const [open, toggleOpen] = useSectionOpen(cookie, initialOpen);

  return (
    <section className="flex flex-col pt-3" aria-label={TEAM_GROUP_LABEL}>
      <SectionHeader label={TEAM_GROUP_LABEL} open={open} onToggle={toggleOpen} />
      {open ? (
        <ul className="flex flex-col gap-0.5 pt-0.5">
          {tasks.map((task) => (
            <TeamTaskRow
              key={sessionRowKey(task.id)}
              task={task}
              active={pathname === `/app/task/${task.id}` || isPendingSessionId(task.id)}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Trailing skeleton rows while the next history page loads. */
function TaskRowSkeletons() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <li key={i} aria-hidden className="flex h-10 items-center px-2.5">
          <span
            className="h-4 animate-pulse rounded-md bg-alpha-6"
            style={{ width: `${72 - i * 14}%` }}
          />
        </li>
      ))}
    </>
  );
}

/** Invisible row that requests the next page when it scrolls into view. */
function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  // Start the fetch a little before the user actually reaches the tail.
  const ref = useLoadMoreSentinel<HTMLLIElement>({
    canLoadMore: true,
    loadMore: onLoadMore,
    rootMargin: '200px',
  });
  return <li ref={ref} aria-hidden className="h-px" />;
}
