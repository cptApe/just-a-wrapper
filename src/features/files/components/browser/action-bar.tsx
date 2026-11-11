'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { type Icon, IconX } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Selection never moves the page. From sm up the bulk actions replace the tab
// toggle inside the same 36px toolbar row and the count takes the filter's slot
// on the right. On phones the tab toggle gives way to "clear + count" in the
// same row and the actions dock to the bottom of the screen as one row of
// icons with short labels, the Google Drive and iOS Files pattern.

export type SelectionAction = {
  id: string;
  label: string;
  icon: Icon;
  onSelect: () => void;
  disabled?: boolean;
  /** Why the action is off. Desktop shows it as a tooltip, phones as a toast on tap. */
  disabledReason?: string;
  destructive?: boolean;
};

export function BrowserActionBar({
  active,
  count,
  actions,
  onClear,
  children,
}: {
  active: boolean;
  count: number;
  actions: SelectionAction[];
  onClear: () => void;
  /** The idle left slot (the tab toggle). */
  children: React.ReactNode;
}) {
  if (!active) return children;
  return (
    <>
      <div
        role="toolbar"
        aria-label="Selection actions"
        className="hidden h-9 items-center gap-1 animate-in fade-in-0 duration-150 sm:flex"
      >
        {actions.map((action) => (
          <InlineAction key={action.id} action={action} />
        ))}
        <ClearButton onClear={onClear} />
      </div>
      <div className="flex h-9 items-center gap-1 animate-in fade-in-0 duration-150 sm:hidden">
        <ClearButton onClear={onClear} className="-ml-2" />
        <span className="text-body font-medium text-foreground tabular">{count} selected</span>
      </div>
      <SelectionDock actions={actions} />
    </>
  );
}

/** "N selected" for the toolbar's right cluster from sm up; phones show the
    count beside the clear button in the left slot instead. */
export function SelectionCount({ count }: { count: number }) {
  return (
    <span className="text-meta font-medium text-foreground tabular max-sm:hidden">
      {count} selected
    </span>
  );
}

function ClearButton({ onClear, className }: { onClear: () => void; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClear}
      aria-label="Clear selection"
      className={className}
    >
      <IconX className="size-4" />
    </Button>
  );
}

function InlineAction({ action }: { action: SelectionAction }) {
  const button = (
    <Button
      type="button"
      variant={action.destructive ? 'destructive' : 'ghost'}
      size="xs"
      onClick={action.onSelect}
      disabled={action.disabled}
    >
      <action.icon className="size-3.5" /> {action.label}
    </Button>
  );
  if (!action.disabled || !action.disabledReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button swallows pointer events, so the tooltip needs a
            hoverable wrapper that keeps the trigger live. */}
        <span
          tabIndex={0}
          className="inline-flex rounded-button outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{action.disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function SelectionDock({ actions }: { actions: SelectionAction[] }) {
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className={cn(
        'fixed inset-x-0 bottom-0 z-sticky border-t border-border bg-background sm:hidden',
        'pb-[env(safe-area-inset-bottom)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
      )}
    >
      <div className="mx-auto flex h-14 max-w-md items-stretch justify-around px-2">
        {actions.map((action) => {
          const explainOnly = action.disabled === true && action.disabledReason !== undefined;
          return (
            <button
              key={action.id}
              type="button"
              disabled={action.disabled && !explainOnly}
              aria-disabled={action.disabled || undefined}
              onClick={() => {
                if (explainOnly) {
                  toast(action.disabledReason);
                  return;
                }
                action.onSelect();
              }}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md touch-manipulation',
                'text-meta font-medium transition-colors active:bg-alpha-6',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                action.destructive ? 'text-destructive' : 'text-foreground',
                'disabled:opacity-40 aria-disabled:opacity-40',
              )}
            >
              <action.icon className="size-5" aria-hidden />
              <span className="max-w-full truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
