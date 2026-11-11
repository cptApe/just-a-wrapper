'use client';

import { IconChevronDown } from '@/components/icons';
// The home top-row triggers ARE nav buttons — reuse the shell's single source of
// nav-button styling (leaf import past the shell barrel, same as the design-system
// nav specimens) so they're identical, not a drifting copy.
import { navItemClasses } from '@/components/layouts/nav-item-classes';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DelayedTooltip } from '@/components/ui/tooltip';
// Type-only import — erased at compile time, so the agents barrel's server-only
// modules never reach this client bundle.
import type { AgentTier } from '@/features/agents';
// Value import from the config leaf (not the barrel) so the server-only siblings
// re-exported by the agents barrel never reach this client bundle. TIER_DISPLAY
// is the single home for the user-facing tier labels + descriptions.
import { TIER_DISPLAY } from '@/features/agents/config';
// Derive credit-rate copy from the multiplier; keep descriptions capability-only.
import { tierCreditRateCopy } from '@/features/billing/lib/credit-math';
import { cn } from '@/lib/utils';

// The Home tier picker: three intelligence tiers — Fast / Balanced / Expert —
// NEVER model names, no versions, no brand. Each item shows a capability line
// with a trailing check on the current tier, and reveals its credit rate on
// hover when billing is on. Sits on the unified glass menu surface (see
// menu-README.md).
//
// The label + capability description live in TIER_DISPLAY (features/agents/
// config), the single home shared with the schedule modal. The credit copy
// lives in tierCreditRateCopy (billing/lib/credit-math), computed from
// TIER_CREDIT_MULTIPLIER so it never hardcodes a numeric multiplier. This
// component only owns the dropdown UI + order.

type TierOption = {
  tier: AgentTier;
  label: string;
  /** What this tier is for (capability only; cost lives in the hover tooltip). */
  description: string;
};

const TIER_ORDER: readonly AgentTier[] = ['fast', 'default', 'pro'];

const TIER_OPTIONS: TierOption[] = TIER_ORDER.map((tier) => ({
  tier,
  label: TIER_DISPLAY[tier].label,
  description: TIER_DISPLAY[tier].description,
}));

export function TierSelect({
  tier,
  onChange,
  disabled,
  showCreditRates,
}: {
  tier: AgentTier;
  onChange: (tier: AgentTier) => void;
  disabled?: boolean;
  showCreditRates: boolean;
}) {
  const current = TIER_DISPLAY[tier];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          // Identical to the app's nav buttons (navItemClasses is the single
          // source). w-auto because a top-row trigger hugs its content instead
          // of filling a sidebar column; disabled utils for the pending state
          // (nav links have none).
          className={cn(
            navItemClasses(false),
            'w-auto disabled:pointer-events-none disabled:opacity-50',
          )}
          aria-label={`Intelligence: ${current.label}`}
          data-testid="tier-select"
        >
          {current.label}
          {/* No per-icon color: the chevron inherits currentColor so the
              trigger's hover brighten (navItemClasses) hits icon + label
              together, matching the shell nav buttons. */}
          <IconChevronDown className="size-5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80" data-testid="tier-select-menu">
        {TIER_OPTIONS.map((option) => {
          const item = (
            <DropdownMenuCheckItem
              key={option.tier}
              checked={option.tier === tier}
              onSelect={() => onChange(option.tier)}
              className="h-auto items-start gap-2.5 py-2"
              data-testid={`tier-option-${option.tier}`}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-body font-medium">{option.label}</span>
                <span className="text-meta text-glass-fg-secondary">{option.description}</span>
              </span>
            </DropdownMenuCheckItem>
          );
          return showCreditRates ? (
            <DelayedTooltip
              key={option.tier}
              side="right"
              content={tierCreditRateCopy(option.tier)}
            >
              {item}
            </DelayedTooltip>
          ) : (
            item
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
