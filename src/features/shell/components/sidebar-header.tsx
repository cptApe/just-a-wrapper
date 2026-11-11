'use client';

import { IconLayoutLeft } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ShellWorkspace } from '../types';
import { WorkspaceSwitcher } from './workspace-switcher';

export function SidebarHeader({
  collapsed,
  railHover,
  workspaceName,
  workspaces,
  toggleCollapsed,
}: {
  collapsed: boolean;
  railHover: boolean;
  workspaceName: string;
  workspaces: ShellWorkspace[];
  toggleCollapsed: () => void;
}) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-1 px-2">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open sidebar"
              data-testid="sidebar-open-button"
              className={cn(
                'flex size-11 cursor-e-resize items-center justify-center rounded-button text-foreground',
                'transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] hover:bg-alpha-6',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              )}
            >
              {railHover ? (
                <IconLayoutLeft className="size-5" />
              ) : (
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-full bg-foreground text-title-card font-semibold text-background"
                >
                  {workspaceName.trim().charAt(0).toUpperCase() || 'W'}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Open sidebar</TooltipContent>
        </Tooltip>
      ) : (
        <>
          <WorkspaceSwitcher workspaces={workspaces} activeName={workspaceName} collapsed={false} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                aria-label="Close sidebar"
                data-testid="sidebar-collapse-toggle"
                className="ml-auto size-11 cursor-w-resize"
              >
                <IconLayoutLeft className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Close sidebar</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
