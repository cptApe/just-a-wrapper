// Public surface of the app shell — the persistent collapsible sidebar that
// wraps every authed surface in the (app) route group. The (app) layout
// resolves the workspace, user, sessions, billing summary and the sidebar
// cookies server-side and hands them to <AppShell>.
export { AppShell } from './components/app-shell';

// The pinned account pill (avatar + name → account menu). The settings shell
// renders the same component in its own sidebar footer, so the account item is
// in the same place in both shells.
export { SidebarFooter } from './components/sidebar-footer';
export {
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_PINNED_OPEN_COOKIE,
  SIDEBAR_TASKS_OPEN_COOKIE,
  SIDEBAR_TEAM_OPEN_COOKIE,
} from './lib/sidebar-cookies';
export type { ShellUser } from './types';
