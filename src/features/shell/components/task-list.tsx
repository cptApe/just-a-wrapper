'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useReducer } from 'react';
import type { WorkspaceSessionListItem } from '@/features/sessions';
import type { TaskListActions } from '../hooks/use-task-list';
import { groupTasks } from '../lib/group-tasks';
import {
  SIDEBAR_PINNED_OPEN_COOKIE,
  SIDEBAR_TASKS_OPEN_COOKIE,
  SIDEBAR_TEAM_OPEN_COOKIE,
} from '../lib/sidebar-cookies';
import { taskDragReducer } from '../lib/task-drag-machine';
import { type DropZone, HistorySection, TeamSection } from './task-history-section';

// Present Pinned, Team and Recents with cookie-persisted section state.
// Team contains other members’ shared tasks; own shared tasks stay in Pinned/Recents.
// Status and menu share one trailing slot; team rows show creator and status only.
// Active rows suppress unread dots, which use --attention.
// A Recents sentinel fetches the next cursor page with trailing skeletons.

export function TaskList({
  tasks,
  viewerId,
  actions,
  initialOpen,
  initialPinnedOpen,
  initialTeamOpen,
  onNavigate,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  tasks: WorkspaceSessionListItem[];
  /** The signed-in viewer — splits own tasks from teammates' shared ones. */
  viewerId: string;
  actions: TaskListActions;
  /** Recents section initial open-state (from the cookie). */
  initialOpen: boolean;
  /** Pinned section initial open-state (from the cookie). */
  initialPinnedOpen: boolean;
  /** Team section initial open-state (from the cookie). */
  initialTeamOpen: boolean;
  onNavigate?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const pathname = usePathname();
  const { pinned, team, recents } = groupTasks(tasks, viewerId);
  const [drag, dispatchDrag] = useReducer(taskDragReducer, { kind: 'idle' });
  const draggedTask = drag.kind === 'dragging' ? drag.task : null;
  const dropTarget = drag.kind === 'dragging' ? drag.target : null;

  useEffect(() => {
    function finishWindowDrag() {
      dispatchDrag({ type: 'finish' });
    }
    window.addEventListener('dragend', finishWindowDrag);
    return () => window.removeEventListener('dragend', finishWindowDrag);
  }, []);

  function finishDrag() {
    dispatchDrag({ type: 'finish' });
  }

  function dropTask(dropZone: DropZone) {
    const favorited = dropZone === 'pinned';
    if (draggedTask && draggedTask.favorited !== favorited) {
      // Dragging and the existing menu converge on the same optimistic
      // mutation, keeping rollback, errors, and reconciliation identical.
      actions.setFavorited(draggedTask.id, favorited);
    }
    finishDrag();
  }

  return (
    <div className="flex flex-col pb-2">
      {pinned.length > 0 || draggedTask?.favorited === false ? (
        <HistorySection
          label="Pinned"
          cookie={SIDEBAR_PINNED_OPEN_COOKIE}
          initialOpen={initialPinnedOpen}
          tasks={pinned}
          viewerId={viewerId}
          actions={actions}
          pathname={pathname}
          onNavigate={onNavigate}
          draggedTask={draggedTask}
          dropZone="pinned"
          dropTarget={dropTarget}
          onDropTargetChange={(target) => dispatchDrag({ type: 'target', target })}
          onDropTask={dropTask}
          onDragTask={(task) => dispatchDrag({ type: 'start', task })}
          onDragEnd={finishDrag}
        />
      ) : null}

      {/* Team renders only when a teammate has shared a task — no empty row; the
          section's absence is the empty state. */}
      {team.length > 0 ? (
        <TeamSection
          cookie={SIDEBAR_TEAM_OPEN_COOKIE}
          initialOpen={initialTeamOpen}
          tasks={team}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ) : null}

      {/* Empty Recents renders nothing — except while a pinned task is being
          dragged, when the section must stay mounted as the unpin drop target
          (mirror of the Pinned condition above). */}
      {recents.length > 0 || draggedTask?.favorited === true ? (
        <HistorySection
          label="Recents"
          cookie={SIDEBAR_TASKS_OPEN_COOKIE}
          initialOpen={initialOpen}
          tasks={recents}
          viewerId={viewerId}
          actions={actions}
          pathname={pathname}
          onNavigate={onNavigate}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          draggedTask={draggedTask}
          dropZone="recents"
          dropTarget={dropTarget}
          onDropTargetChange={(target) => dispatchDrag({ type: 'target', target })}
          onDropTask={dropTask}
          onDragTask={(task) => dispatchDrag({ type: 'start', task })}
          onDragEnd={finishDrag}
        />
      ) : null}
    </div>
  );
}
