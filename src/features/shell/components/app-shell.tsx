'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { IconEdit05 } from '@/components/icons';
import { MobileNavButton, MobileNavProvider } from '@/components/layouts/mobile-nav';
import { MobileTopBar } from '@/components/layouts/mobile-top-bar';
import { useViewer } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { discardDraft } from '@/features/chat/browser';
import { useNotificationsFeed } from '@/features/notifications/hooks/use-notifications-feed';
import type { WorkspaceSessionListItem } from '@/features/sessions';
import { useSessionMutations } from '@/features/sessions/api/use-session-mutations';
import { AppError } from '@/lib/errors';
import { type TaskListActions, useTaskList } from '../hooks/use-task-list';
import { navPageTitle } from '../lib/nav';
import { SIDEBAR_COLLAPSED_COOKIE, writeSidebarCookie } from '../lib/sidebar-cookies';
import type { ShellWorkspace } from '../types';
import { DesktopSidebar } from './desktop-sidebar';
import { MobileSidebar } from './mobile-sidebar';

// The persistent product chrome: a single collapsible left
// sidebar. Collapsed, it becomes an icon rail whose background (anything not
// marked data-rail-item) is one big open-sidebar affordance. The collapse
// preference is a cookie the server layout reads, so the first SSR paint
// already matches and there is no hydration flash.
//
// Owns the shell's one workspace-channel subscription (via useTaskList):
// auto-titles and cross-tab session creation update the sidebar live.
export function AppShell({
  workspaceName,
  organizationId,
  workspaces,
  sessions,
  sessionsCursor = null,
  initialCollapsed,
  initialTasksOpen,
  initialPinnedOpen,
  initialTeamOpen,
  children,
}: {
  workspaceName: string;
  organizationId: string;
  workspaces: ShellWorkspace[];
  sessions: WorkspaceSessionListItem[];
  /** Cursor for the task history's next page (null = the list is complete). */
  sessionsCursor?: string | null;
  initialCollapsed: boolean;
  initialTasksOpen: boolean;
  initialPinnedOpen: boolean;
  initialTeamOpen: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // The (shell) layout provides the viewer; its id keys the private member realtime channel.
  const viewer = useViewer();
  if (viewer === null) throw new AppError('UNEXPECTED', 'ViewerProvider is missing', {});
  const { id: userId, ...user } = viewer;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { metadata } = useNotificationsFeed();
  const unread = metadata.unseenCount;

  // Below md, each page has one top bar. Home and Task supply their own header
  // and navigation button, so the shell hides its bar on those routes.
  const showShellBar = !(pathname === '/app' || pathname.startsWith('/app/task/'));
  const { rename, setFavorited, remove, markSeen } = useSessionMutations(
    organizationId,
    discardDraft,
  );
  const { tasks, loadMore, loadingMore, hasMore } = useTaskList(
    sessions,
    organizationId,
    userId,
    sessionsCursor,
    markSeen,
  );
  const taskList = {
    tasks,
    viewerId: userId,
    actions: { rename, setFavorited, remove } satisfies TaskListActions,
    initialOpen: initialTasksOpen,
    initialPinnedOpen,
    initialTeamOpen,
    hasMore,
    loadingMore,
    onLoadMore: loadMore,
  };

  function toggleCollapsed() {
    setCollapsed((prev) => {
      writeSidebarCookie(SIDEBAR_COLLAPSED_COOKIE, !prev);
      return !prev;
    });
  }

  return (
    <MobileNavProvider value={{ openNav: () => setMobileOpen(true), unread }}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-dvh overflow-clip bg-background text-foreground">
          <DesktopSidebar
            collapsed={collapsed}
            workspaceName={workspaceName}
            workspaces={workspaces}
            user={user}
            toggleCollapsed={toggleCollapsed}
            taskList={taskList}
          />

          {/* Mobile drawer: the full expanded sidebar content. */}
          <MobileSidebar
            open={mobileOpen}
            onOpenChange={setMobileOpen}
            onNavigate={() => setMobileOpen(false)}
            workspaces={workspaces}
            workspaceName={workspaceName}
            user={user}
            taskList={taskList}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile-only shell chrome bar — desktop pages own their own headers.
              Home and Task stand this down (showShellBar) because they render
              their own single bar. Elsewhere it names the page with the
              sidebar's own nav label, so the two never disagree. */}
            {showShellBar ? (
              <MobileTopBar
                leading={<MobileNavButton className="-ml-2" />}
                title={navPageTitle(pathname)}
                trailing={
                  // New task is always one tap away on mobile (top-right).
                  // size-11 keeps the tap target at 44px; the glyph stays small.
                  <Button asChild type="button" variant="ghost" size="icon" className="size-11">
                    <Link href="/app" aria-label="New task">
                      <IconEdit05 className="size-5" />
                    </Link>
                  </Button>
                }
              />
            ) : null}

            {/* A plain <div>, not <main>, so pages that bring their own <main>
            landmark don't nest. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </div>
        </div>
      </TooltipProvider>
    </MobileNavProvider>
  );
}
