'use client';

import Link from 'next/link';
import { IconChevronRight, IconCoins01 } from '@/components/icons';
// The credits chip is a nav button — reuse the shell's single source of
// nav-button styling so it's identical to the sidebar nav, not a copy.
import { navItemClasses } from '@/components/layouts/nav-item-classes';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuActionItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PLANS, type WorkspacePlan } from '@/features/billing/pricing-config';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import { formatDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import { cn } from '@/lib/utils';

// The Home header's credits popover: a plan + Add credits header, the credit
// breakdown, then "View usage". A real instance of the unified glass menu surface (DropdownMenu, see
// menu-README.md), not a light popover force-painted to look like glass: the
// surface, radius, shadow and separators all come from the primitive, and
// "View usage" is a real menu item so its hover is the padded item background
// like every other menu. Pure presentation — the page resolves every number
// server-side (features/billing owns the queries).

export type HomeBilling = {
  creditBalance: number;
  isSubscribed: boolean;
  /** The workspace's plan, or 'none' when it pays with bought credits. */
  planTier: WorkspacePlan;
  planCreditsExpireAt: Date | null;
  /** Credits consumed this billing cycle. */
  creditsUsedThisCycle: number;
};

export function HomeCreditsPopover({ billing }: { billing: HomeBilling }) {
  const planLabel = billing.planTier === 'none' ? 'Pay as you go' : PLANS[billing.planTier].name;
  const { timeZone } = useDisplayFormat();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Identical to the app's nav buttons (navItemClasses is the single
          // source); w-auto because the trigger hugs its content.
          className={cn(navItemClasses(false), 'w-auto tabular-nums')}
          aria-label={`Credits: ${formatCount(billing.creditBalance)}`}
          data-testid="credits-chip"
        >
          {/* No per-icon color: the coin glyph inherits currentColor so the
              chip's hover brighten (navItemClasses) hits icon + number
              together, matching the shell nav buttons. */}
          <IconCoins01 className="size-5 shrink-0" />
          {formatCount(billing.creditBalance)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" data-testid="credits-popover">
        {/* Plan + Add credits header — a display block, not a selectable row; padded
            to the item rhythm (px-2.5) so it lines up with the menu items. */}
        <div className="flex items-center justify-between gap-3 px-2.5 pt-1.5 pb-2">
          <span className="text-body-lg font-semibold">{planLabel}</span>
          {/* Real menu item so roving focus reaches it by keyboard; keeps its
              pill-button look via DropdownMenuActionItem (asChild). */}
          <DropdownMenuActionItem onSelect={() => openOverlay('topup')}>
            <Button
              type="button"
              size="sm"
              className="h-8 bg-glass-fg px-3.5 font-medium text-glass-fg-foreground hover:bg-glass-fg/90"
            >
              Add credits
            </Button>
          </DropdownMenuActionItem>
        </div>

        <DropdownMenuSeparator />

        <div className="flex flex-col gap-2.5 px-2.5 py-2 text-body">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <IconCoins01 className="size-4 text-glass-fg-secondary" />
              Credits
            </span>
            <span className="font-medium tabular-nums">{formatCount(billing.creditBalance)}</span>
          </div>

          <div className="flex items-center justify-between gap-2 text-glass-fg-secondary">
            <span>Used this cycle</span>
            <span className="tabular-nums">{formatCount(billing.creditsUsedThisCycle)}</span>
          </div>

          {billing.planCreditsExpireAt ? (
            <p className="text-meta text-glass-fg-tertiary">
              This month&apos;s credits last until{' '}
              {formatDate(billing.planCreditsExpireAt, timeZone)}
            </p>
          ) : null}
        </div>

        <DropdownMenuSeparator />

        {/* Open the Usage page for the full credit breakdown. */}
        <DropdownMenuItem asChild data-testid="credits-usage-link">
          <Link href="/app/settings/usage">
            View usage
            <IconChevronRight className="ml-auto size-4 text-glass-fg-secondary" />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
