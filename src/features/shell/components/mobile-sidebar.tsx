'use client';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { ShellUser, ShellWorkspace } from '../types';
import { NotificationsNavItem } from './notifications-nav-item';
import { NewTaskLink, ShellNav } from './shell-nav';
import { SidebarFooter } from './sidebar-footer';
import { TaskList } from './task-list';
import { WorkspaceSwitcher } from './workspace-switcher';

export function MobileSidebar({
  open,
  onOpenChange,
  onNavigate,
  workspaces,
  workspaceName,
  user,
  taskList,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
  workspaces: ShellWorkspace[];
  workspaceName: string;
  user: ShellUser;
  taskList: React.ComponentProps<typeof TaskList>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Match the desktop <aside> exactly (bg, hairline, width, square
          corners) so the mobile drawer reads as the same sidebar sliding
          in, not a different surface. */}
      <SheetContent
        side="left"
        className="flex w-[var(--sidebar-w)] flex-col rounded-none border-r border-border bg-background p-0 max-md:[&>button]:size-11 max-md:[&>button]:right-2 max-md:[&>button]:top-[max(env(safe-area-inset-top),0.5rem)]"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {/* The header row and the close button share the phone top bar's inset,
            so they line up with each other and clear the status bar. */}
        <div className="mobile-top-inset flex shrink-0 items-center gap-1 px-2 pb-1 pr-14">
          <WorkspaceSwitcher workspaces={workspaces} activeName={workspaceName} collapsed={false} />
        </div>
        <div className="shrink-0 px-2 pb-1 pt-1">
          <NewTaskLink onNavigate={onNavigate} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          <ShellNav onNavigate={onNavigate} trailing={<NotificationsNavItem side="bottom" />} />
          <TaskList {...taskList} onNavigate={onNavigate} />
        </div>
        <SidebarFooter user={user} />
      </SheetContent>
    </Sheet>
  );
}
