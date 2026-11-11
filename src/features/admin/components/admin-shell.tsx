'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { IconArrowLeft, IconMenu05 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Modal, ModalTitle } from '@/components/ui/modal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type ShellUser, SidebarFooter } from '@/features/shell';
import { cn } from '@/lib/utils';
import { AdminCommandMenu } from './admin-command-menu';
import { AdminNav } from './admin-nav';
import { AdminTableOfContents } from './admin-table-of-contents';

function BackToApp({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/app"
      onClick={onNavigate}
      className={cn(
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
  version,
  user,
  onNavigate,
}: {
  version: string;
  user: ShellUser | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center px-2">
        <BackToApp onNavigate={onNavigate} />
      </div>
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 [--scroll-fade-size:16px]">
        <AdminNav forkVersion={version} onNavigate={onNavigate} />
      </div>
      {user ? <SidebarFooter user={user} /> : null}
    </>
  );
}

export function AdminShell({
  version,
  user = null,
  children,
}: {
  version: string;
  user?: ShellUser | null;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    // /admin renders outside <AppShell>, so tooltips need their own provider.
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh overflow-clip bg-background text-foreground">
        <aside
          data-testid="admin-sidebar"
          className="hidden w-[var(--sidebar-w)] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
        >
          <SidebarContent version={version} user={user} />
        </aside>

        <Modal
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          presentation="sheet"
          side="left"
          size="sm"
        >
          <ModalTitle className="sr-only">Admin navigation</ModalTitle>
          <SidebarContent version={version} user={user} onNavigate={() => setMobileOpen(false)} />
        </Modal>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              aria-label="Open admin navigation"
              className="-ml-2 size-11"
            >
              <IconMenu05 className="size-5" />
            </Button>
            <span className="text-title-card font-medium">Admin</span>
          </header>

          <div className="flex min-h-0 flex-1">
            <div
              className="min-w-0 flex-1 overflow-y-auto overscroll-contain"
              data-admin-scroll-container
            >
              {children}
            </div>
            <AdminTableOfContents key={pathname} />
          </div>
        </div>
      </div>
      <AdminCommandMenu />
    </TooltipProvider>
  );
}
