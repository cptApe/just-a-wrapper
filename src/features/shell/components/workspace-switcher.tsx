'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { IconChevronDown, IconPlus, IconSettings01, IconUsers01 } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { switchWorkspace } from '@/features/workspaces/api/switch-workspace';
import { captureException } from '@/lib/observability-client';
import { cn } from '@/lib/utils';
import type { ShellWorkspace } from '../types';

// The top-left workspace chip + switcher (Slack pattern: top left is the
// workspace, bottom left is your account).
//
// Switch semantics: set the active organization, flush the client query cache,
// land on /app, refresh. The QueryClient is cache-forever (gcTime: Infinity) and
// survives this soft navigation, so the previous workspace's entries would live in
// memory forever — queryClient.clear() drops them. Every cached query is
// workspace-derived, so a full clear is correct. router.refresh() then re-derives
// the whole RSC tree from the new active org, and the shell's SSE subscription
// re-keys off the refreshed organizationId prop. Landing on /app first avoids
// leaving the user on a stale resource page (e.g. a /chat/[id] from the previous
// workspace).
export function WorkspaceSwitcher({
  workspaces,
  activeName,
  collapsed,
}: {
  workspaces: ShellWorkspace[];
  activeName: string;
  collapsed: boolean;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const otherWorkspaces = workspaces.filter((workspace) => !workspace.isActive);

  async function switchTo(organizationId: string) {
    setSwitching(true);
    try {
      const outcome = await switchWorkspace(organizationId);
      if (!outcome.ok) {
        toast.error(outcome.message);
        return;
      }
      router.push('/app');
      router.refresh();
    } catch (cause) {
      captureException(cause, { op: 'workspace.switch' });
      toast.error('Could not reach the server. Check your connection and try again.');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch workspace"
          data-testid="workspace-switcher-trigger"
          disabled={switching}
          className={cn(
            'flex items-center gap-2.5 rounded-button text-left',
            'hover:bg-alpha-6',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            'disabled:opacity-60',
            // Hug avatar + name + chevron; cap the width so a long name
            // truncates instead of stretching the chip (don't grow to flex-1 —
            // the collapse toggle is ml-auto'd to the edge, not pushed by this).
            collapsed ? 'p-1' : 'min-w-0 max-w-[15rem] px-1.5 py-1.5',
          )}
        >
          <WorkspaceAvatar name={activeName} />
          {!collapsed ? (
            <>
              <span
                className="min-w-0 flex-1 truncate text-body-lg font-semibold tracking-tight"
                title={activeName}
              >
                {activeName}
              </span>
              <IconChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72" data-testid="workspace-switcher-menu">
          <DropdownMenuItem asChild>
            <Link href="/app/settings/workspace" data-testid="workspace-settings">
              <IconSettings01 />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/settings/members" data-testid="workspace-members">
              <IconUsers01 />
              Members
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {otherWorkspaces.length > 0 ? (
            <>
              <DropdownMenuLabel>Switch to</DropdownMenuLabel>
              {otherWorkspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.organizationId}
                  disabled={switching}
                  data-testid="workspace-switcher-item"
                  onSelect={(e) => {
                    // Keep the menu open on switch — router.refresh() re-renders it
                    // in place. (Create, below, closes the menu so its modal can take over.)
                    e.preventDefault();
                    void switchTo(workspace.organizationId);
                  }}
                  className="h-12 gap-2.5"
                >
                  <WorkspaceAvatar name={workspace.name} />
                  <span className="min-w-0 flex-1 truncate text-body">{workspace.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {/* With other workspaces listed, Create sits in their avatar column
              behind a dashed circle; alone, it is a plain row like Settings. */}
          <DropdownMenuItem
            onSelect={() => openOverlay(buildOverlayHash('new-workspace'))}
            data-testid="workspace-switcher-create"
            className={otherWorkspaces.length > 0 ? 'h-12 gap-2.5 text-body' : undefined}
          >
            {otherWorkspaces.length > 0 ? (
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-glass-separator border-dashed"
                aria-hidden
              >
                <IconPlus className="size-4" />
              </span>
            ) : (
              <IconPlus />
            )}
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function WorkspaceAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-title-card font-semibold text-background',
        className,
      )}
      aria-hidden
    >
      {(name.trim().at(0) ?? '?').toUpperCase()}
    </span>
  );
}
