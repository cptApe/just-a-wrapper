'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ShellUser, ShellWorkspace } from '../types';
import { NotificationsNavItem, NotificationsRailItem } from './notifications-nav-item';
import { NewTaskLink, RailNav, RailNewTaskLink, ShellNav } from './shell-nav';
import { SidebarFooter } from './sidebar-footer';
import { SidebarHeader } from './sidebar-header';
import { TaskList } from './task-list';

export function DesktopSidebar({
  collapsed,
  workspaceName,
  workspaces,
  user,
  toggleCollapsed,
  taskList,
}: {
  collapsed: boolean;
  workspaceName: string;
  workspaces: ShellWorkspace[];
  user: ShellUser;
  toggleCollapsed: () => void;
  taskList: React.ComponentProps<typeof TaskList>;
}) {
  const [railHover, setRailHover] = useState(false);
  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed}
      className={cn(
        'hidden shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground md:flex',
        'border-r border-border',
        'transition-[width] duration-200 ease-[cubic-bezier(0,0,0.2,1)]',
        collapsed ? 'w-[var(--sidebar-w-collapsed)]' : 'w-[var(--sidebar-w)]',
      )}
      // Only real pointer movement over the settled rail swaps the workspace
      // avatar for the open icon. The width animation moves the sidebar under a
      // resting pointer, and browsers report that as a mouse enter.
      onMouseMove={(e) => setRailHover(collapsed && e.currentTarget.getAnimations().length === 0)}
      onMouseLeave={() => setRailHover(false)}
    >
      {/* One adaptive tree, not two — the section containers and the footer
              persist across collapse so React reconciles in place instead of
              unmounting/remounting the whole sidebar (no toggle flicker). Only
              each section's children swap. */}
      <div
        data-testid={collapsed ? 'sidebar-rail' : undefined}
        className={cn('flex h-full w-full flex-col', collapsed && 'cursor-e-resize')}
        onClick={
          collapsed
            ? (e) => {
                // The rail background is the open affordance. React bubbles
                // events through the component tree, so a click in a *portaled*
                // child (footer menu, tooltips) reaches here though it renders
                // at document.body — the contains() check rejects those, or
                // picking a footer menu item would re-expand the sidebar.
                if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target)) return;
                if (e.target.closest('[data-rail-item]')) return;
                toggleCollapsed();
              }
            : undefined
        }
      >
        {/* Header — fixed 64px datum that page headers align to. */}
        <SidebarHeader
          collapsed={collapsed}
          railHover={railHover}
          workspaceName={workspaceName}
          workspaces={workspaces}
          toggleCollapsed={toggleCollapsed}
        />

        {/* New task — fixed block. data-rail-item (collapsed) keeps the rail's
                open-on-click affordance off it. */}
        <div className="shrink-0 px-2 pb-0.5" data-rail-item={collapsed ? true : undefined}>
          {collapsed ? <RailNewTaskLink /> : <NewTaskLink />}
        </div>

        {collapsed ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            <RailNav trailing={<NotificationsRailItem />} />
          </div>
        ) : (
          /* nav + history scroll together. The shadcn
                 `scroll-fade` utility (globals.css) masks the top + bottom edges
                 so content dissolves into the header/footer — CSS-only and
                 scroll-aware, so each edge fades only when there's overflow past
                 it. The 16px depth is a quiet quarter of the thread's fade,
                 tuned for the narrow sidebar so it never swallows a row. */
          <div
            className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 [--scroll-fade-size:16px]"
            data-testid="sidebar-scroll"
          >
            <ShellNav trailing={<NotificationsNavItem side="right" />} />
            <TaskList {...taskList} />
          </div>
        )}

        <SidebarFooter user={user} collapsed={collapsed} />
      </div>
    </aside>
  );
}
