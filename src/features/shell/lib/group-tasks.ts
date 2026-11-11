import type { WorkspaceSessionListItem } from '@/features/sessions';

// One shared label names the sidebar task group.
export const TEAM_GROUP_LABEL = 'Team';

export type TaskGroups = {
  /** The viewer's pinned tasks (own or their own shared). */
  pinned: WorkspaceSessionListItem[];
  /** Teammates' shared tasks — the workspace's shared surface. */
  team: WorkspaceSessionListItem[];
  /** Everything else, newest first. */
  recents: WorkspaceSessionListItem[];
};

// A workspace-visible task created by ANOTHER member. This is the sole Team
// membership rule; the sidebar and the row rendering both read it from here so
// server-filtered visibility and client grouping never drift.
function isTeamTask(task: WorkspaceSessionListItem, viewerId: string): boolean {
  return task.visibility === 'workspace' && task.createdByUserId !== viewerId;
}

// The viewer's OWN task that they've shared with the workspace. It stays in
// Pinned/Recents (sharing must not reshuffle the owner's own map) but earns a
// subtle shared indicator on its row.
export function isSharedByViewer(task: WorkspaceSessionListItem, viewerId: string): boolean {
  return task.visibility === 'workspace' && task.createdByUserId === viewerId;
}

// Partition the merged, already-sorted list (pinned-first, then recency) into the
// three sidebar groups in one pass, preserving order within each. Team membership
// takes precedence over pinning: a teammate's shared task belongs to Team even if
// its workspace-global favorited_at is set (the viewer can't pin it themselves).
export function groupTasks(tasks: WorkspaceSessionListItem[], viewerId: string): TaskGroups {
  const pinned: WorkspaceSessionListItem[] = [];
  const team: WorkspaceSessionListItem[] = [];
  const recents: WorkspaceSessionListItem[] = [];
  for (const task of tasks) {
    if (isTeamTask(task, viewerId)) {
      team.push(task);
    } else if (task.favoritedAt) {
      pinned.push(task);
    } else {
      recents.push(task);
    }
  }
  return { pinned, team, recents };
}
