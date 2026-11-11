'use client';

import { IconSearchMd } from '@/components/icons';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useModifierKey } from '../hooks/use-modifier-key';
import { openCommandSearch } from '../lib/open-search';

// Search is an action, not a destination. Receive shell classes as props to avoid a shell/search import cycle.
export function SearchNavItem({
  className,
  onOpen,
}: {
  /** navItemClasses(false) from the shell — the shared inactive row look. */
  className: string;
  /** Called before opening (the mobile sheet closes itself here). */
  onOpen?: () => void;
}) {
  const modifier = useModifierKey();
  return (
    <button
      type="button"
      data-testid="sidebar-search"
      className={className}
      onClick={() => {
        onOpen?.();
        openCommandSearch();
      }}
    >
      <IconSearchMd className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">Search</span>
      {/* Phones have no keyboard shortcut to advertise. */}
      <KbdGroup aria-hidden className="shrink-0 max-md:hidden">
        <Kbd>{modifier}</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </button>
  );
}

/** Collapsed-rail form: icon only, tooltip label, same open action. */
export function RailSearchNavItem({ className }: { className: string }) {
  const modifier = useModifierKey();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-rail-item
          data-testid="sidebar-search"
          aria-label="Search"
          className={className}
          onClick={openCommandSearch}
        >
          <IconSearchMd className="size-5 shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Search · {modifier} K</TooltipContent>
    </Tooltip>
  );
}
