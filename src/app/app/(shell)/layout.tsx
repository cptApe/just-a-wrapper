import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ViewerProvider } from '@/components/providers/app-providers';
import { loginRedirectUrl } from '@/features/auth/lib/login-redirect';
import { scheduleStaleSessionSweep } from '@/features/jobs/server';
import {
  AppShell,
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_PINNED_OPEN_COOKIE,
  SIDEBAR_TASKS_OPEN_COOKIE,
  SIDEBAR_TEAM_OPEN_COOKIE,
} from '@/features/shell';
import { loadShellGate } from '@/features/shell/api/load-shell-gate';
import { loadSidebar } from '@/features/shell/api/load-sidebar';
import { NamePrompt } from '@/features/shell/components/name-prompt';
import { ShellRecovery } from '@/features/shell/components/shell-recovery';
import { withRequestContext } from '@/lib/request-context';

// The server gate checks active membership before rendering workspace content.
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const shell = await withRequestContext({ route: 'app-group-layout' }, async () =>
    loadShellGate(await headers()),
  );
  switch (shell.kind) {
    case 'signed_out':
      redirect(await loginRedirectUrl());
    case 'failed':
      return <ShellRecovery workspaces={shell.workspaces} />;
    case 'ready':
      break;
  }

  const sidebar = await withRequestContext(
    { route: 'app-group-layout', feature: 'shell' },
    async () => {
      scheduleStaleSessionSweep();
      return loadSidebar({
        organizationId: shell.organizationId,
        userId: shell.userId,
        workspaces: shell.workspaces,
      });
    },
  );
  // Sidebar preferences ride cookies so this server render already matches the
  // stored state — no post-hydration flash.
  const jar = await cookies();
  const initialCollapsed = jar.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1';
  const initialTasksOpen = jar.get(SIDEBAR_TASKS_OPEN_COOKIE)?.value !== '0';
  const initialPinnedOpen = jar.get(SIDEBAR_PINNED_OPEN_COOKIE)?.value !== '0';
  const initialTeamOpen = jar.get(SIDEBAR_TEAM_OPEN_COOKIE)?.value !== '0';

  return (
    <ViewerProvider
      value={{
        id: shell.userId,
        name: shell.user.name,
        email: shell.user.email,
        image: shell.user.image,
      }}
    >
      <AppShell
        workspaceName={shell.workspaceName}
        organizationId={shell.organizationId}
        workspaces={sidebar.workspaces}
        sessions={sidebar.sessions}
        sessionsCursor={sidebar.sessionsCursor}
        initialCollapsed={initialCollapsed}
        initialTasksOpen={initialTasksOpen}
        initialPinnedOpen={initialPinnedOpen}
        initialTeamOpen={initialTeamOpen}
      >
        {children}
      </AppShell>
      {shell.user.name?.trim() ? null : <NamePrompt />}
    </ViewerProvider>
  );
}
