'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { IconArrowLeft, IconMenu05 } from '@/components/icons';
import { MobileTopBar } from '@/components/layouts/mobile-top-bar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type ShellUser, SidebarFooter } from '@/features/shell';
import { cn } from '@/lib/utils';
import { settingsPageTitle } from '../lib/settings-nav-items';
import { SettingsNav } from './settings-nav';

// Sits in the h-16 header datum where the app shell's workspace chip sits, so
// switching between the two shells doesn't move the top-left anchor.
function BackToApp({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/app"
      onClick={onNavigate}
      className={cn(
        // Exactly the nav-pill metrics (h-11, px-3, gap-3, size-5 icon,
        // text-body-lg) — same 44px height as the workspace chip + nav items,
        // arrow on the shared 30px icon axis, and tight balanced padding.
        'flex h-11 items-center gap-3 rounded-button px-3',
        'text-body-lg font-medium text-foreground/80',
        'hover:bg-alpha-6 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      )}
    >
      <IconArrowLeft className="size-5 shrink-0" aria-hidden />
      <span className="truncate">Back to app</span>
    </Link>
  );
}

function SidebarContent({
  isAdmin,
  user,
  onNavigate,
  drawer = false,
}: {
  isAdmin: boolean;
  user: ShellUser;
  onNavigate?: () => void;
  /** In the phone drawer the header clears the status bar and the close button. */
  drawer?: boolean;
}) {
  return (
    <>
      {/* Header — fixed 64px datum that page headers align to (matches app-shell).
          The drawer copy matches MobileSidebar's header row instead. */}
      <div
        className={cn(
          'flex shrink-0 items-center px-2',
          drawer ? 'mobile-top-inset pb-1 pr-14' : 'h-16',
        )}
      >
        <BackToApp onNavigate={onNavigate} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2">
        <SettingsNav isAdmin={isAdmin} onNavigate={onNavigate} />
      </div>
      <SidebarFooter user={user} />
    </>
  );
}

// Match app-sidebar geometry and its footer so identity stays anchored; settings remains a fixed, focused detour.
export function SettingsShell({
  isAdmin,
  user,
  children,
}: {
  isAdmin: boolean;
  user: ShellUser;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    // TooltipProvider: settings renders outside <AppShell>, so InfoHint
    // tooltips need their own provider here (mirrors app-shell.tsx).
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <aside
          data-testid="settings-sidebar"
          className="hidden w-[var(--sidebar-w)] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
        >
          <SidebarContent isAdmin={isAdmin} user={user} />
        </aside>

        {/* Mobile drawer: the same sidebar content in the same edge drawer the
            app shell uses (MobileSidebar), so both drawers look and close alike. */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="flex w-[var(--sidebar-w)] flex-col rounded-none border-r border-border bg-background p-0 max-md:[&>button]:size-11 max-md:[&>button]:right-2 max-md:[&>button]:top-[max(env(safe-area-inset-top),0.5rem)]"
          >
            <SheetTitle className="sr-only">Settings navigation</SheetTitle>
            <SidebarContent
              isAdmin={isAdmin}
              user={user}
              onNavigate={() => setMobileOpen(false)}
              drawer
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile-only top bar — desktop has no chrome beyond the sidebar.
              It names the settings page with the rail's own label. */}
          <MobileTopBar
            leading={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(true)}
                aria-label="Open settings navigation"
                className="-ml-2 size-11"
              >
                <IconMenu05 className="size-5" />
              </Button>
            }
            title={settingsPageTitle(pathname)}
          />

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-page-reading px-4 pb-24 pt-6 sm:px-6 md:px-10 md:pt-12">
              {children}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
