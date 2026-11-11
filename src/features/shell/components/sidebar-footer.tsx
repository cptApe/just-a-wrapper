'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  IconHelpCircle,
  IconLogOut01,
  IconMessageTextCircle02,
  IconSettings01,
  IconUser01,
} from '@/components/icons';
import { useContactDetails } from '@/components/providers/contact-details-provider';
import { ThemeMenuSwitch } from '@/components/theme/theme-switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { resetIdentity } from '@/lib/analytics-client';
import { authClient } from '@/lib/auth-client';
import { initialsFrom } from '@/lib/initials';
import { captureException } from '@/lib/observability-client';
import { cn } from '@/lib/utils';
import type { ShellUser } from '../types';

// Sidebar footer: the PERSONAL account menu only — identity,
// Settings, the quick theme toggle, and sign out. Workspace-scoped things
// (billing, credits, members) live in the top workspace switcher, not here.

export function SidebarFooter({
  user,
  collapsed,
}: {
  user: ShellUser;
  /** Rail mode: avatar-only account trigger. */
  collapsed?: boolean;
}) {
  return (
    <div className="shrink-0 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <AccountMenu user={user} collapsed={collapsed} />
    </div>
  );
}

function AccountMenu({ user, collapsed }: { user: ShellUser; collapsed?: boolean }) {
  const router = useRouter();
  const { supportEmail } = useContactDetails();
  const [signingOut, setSigningOut] = useState(false);
  const label = user.name || user.email;

  async function signOut() {
    setSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        setSigningOut(false);
        toast.error(error.message ?? 'Could not sign out. Please try again.');
        return;
      }
      // Drop the PostHog identity so the next person on this device is a fresh
      // profile; then keep the pending label through the redirect.
      resetIdentity();
      router.push('/login');
    } catch (cause) {
      captureException(cause, { op: 'account.sign-out' });
      setSigningOut(false);
      toast.error('Could not reach the server. Check your connection and try again.');
    }
  }

  const accountTrigger = (
    <DropdownMenuTrigger
      aria-label="Account"
      data-rail-item={collapsed ? true : undefined}
      className={cn(
        'hover:bg-alpha-6',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        collapsed
          ? 'flex size-11 items-center justify-center rounded-button'
          : 'flex h-11 w-full items-center gap-2.5 rounded-button px-2 text-left',
      )}
    >
      <Avatar className="size-7 shrink-0">
        {user.image ? <AvatarImage src={user.image} alt="" /> : null}
        <AvatarFallback className="text-meta">{initialsFrom(user.name, user.email)}</AvatarFallback>
      </Avatar>
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate font-normal text-meta text-foreground/70">
          {label}
        </span>
      )}
    </DropdownMenuTrigger>
  );

  return (
    <>
      <DropdownMenu>
        {/* The Tooltip stays mounted in both states: dropping it remounts the
            avatar, and Radix then shows the initials until the image reloads.
            Only the rail has no label, so only the rail gets the tip. */}
        <Tooltip>
          <TooltipTrigger asChild>{accountTrigger}</TooltipTrigger>
          {collapsed ? <TooltipContent side="right">{label}</TooltipContent> : null}
        </Tooltip>
        <DropdownMenuContent align="start" side="top" className="w-64" data-testid="account-menu">
          <div className="px-2.5 pt-1 pb-1.5">
            <p className="truncate font-medium text-meta">{label}</p>
            <p className="truncate text-meta font-medium text-glass-fg-secondary">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/app/settings/account">
              <IconUser01 />
              Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/settings/general">
              <IconSettings01 />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* The segments are real menu radio items (keyboard-reachable inside a
              Radix menu); the row label itself is static. Picking a mode keeps
              the menu open. */}
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 font-medium text-title-card">
            <span>Theme</span>
            <ThemeMenuSwitch />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={`mailto:${supportEmail}`}>
              <IconHelpCircle />
              Get help
            </a>
          </DropdownMenuItem>
          {/* Opens the #feedback hash overlay (registered in the overlays
              registry) — self-sufficient and deep-linkable, so support can link
              straight to it. */}
          <DropdownMenuItem onSelect={() => openOverlay(buildOverlayHash('feedback'))}>
            <IconMessageTextCircle02 />
            Leave feedback
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={signingOut}
            onSelect={(e) => {
              // Keep the menu open through the async sign-out so the label can show
              // progress; the redirect tears it all down.
              e.preventDefault();
              void signOut();
            }}
          >
            <IconLogOut01 />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
