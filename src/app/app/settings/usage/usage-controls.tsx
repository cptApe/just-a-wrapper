'use client';

import { useQueryStates } from 'nuqs';
import { type FormEvent, type ReactNode, use, useReducer } from 'react';
import { IconLock01, IconXClose } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DelayedTooltip } from '@/components/ui/tooltip';
import { normalizeUsageParams, usagePageParsers } from './usage-params';
import { usagePeriodPillClass } from './usage-period-pill';
import { rangeReducer } from './usage-range-machine';

type PeriodKey = 'cycle' | 'last' | 'custom';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoUtc(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

// Period and member controls define the data below and stay outside its Suspense boundary.
// URL-derived state updates them in place during refetch.
export function UsageControls({
  lastCycleAvailable,
  children,
}: {
  lastCycleAvailable: boolean;
  /** The member-filter chip slot — its own boundary, so the identity lookup that
      feeds it never blocks the data below or this control's first paint. */
  children?: ReactNode;
}) {
  const [params, setParams] = useQueryStates(usagePageParsers);
  const { period, from, to } = normalizeUsageParams(params);

  // A "last" request with no reset boundary falls back to the cycle internally —
  // don't highlight the disabled option.
  const urlPeriod: PeriodKey = period;
  const activePeriod: PeriodKey = urlPeriod === 'last' && !lastCycleAvailable ? 'cycle' : urlPeriod;

  // Switch to a preset window. A new window restarts the log at its first page
  // (?events resets); clicking the active preset is a no-op.
  function selectPreset(next: Exclude<PeriodKey, 'custom'>) {
    if (next === urlPeriod) return;
    void setParams({ period: next, from: null, to: null, events: null });
  }

  // Commit a COMPLETE custom range in one write: period + both bounds land in a
  // single url update, so the data re-suspends exactly once. Selecting Custom
  // itself writes nothing (the popover holds the draft), so it never reloads.
  function applyCustomRange(nextFrom: string, nextTo: string) {
    void setParams({ period: 'custom', from: nextFrom, to: nextTo, events: null });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="usage-controls">
      <PeriodControl
        active={activePeriod}
        lastCycleAvailable={lastCycleAvailable}
        from={from}
        to={to}
        onSelectPreset={selectPreset}
        onApplyCustom={applyCustomRange}
      />
      {children}
    </div>
  );
}

// The "Showing <member>" filter chip, resolved from the identity promise the
// shell kicks off in parallel with the data loaders (so it never gates them).
// It lives in its own Suspense boundary; a foreign / unresolved id → no chip.
export function MemberFilterChip({
  identity,
}: {
  identity: Promise<{ name: string; email: string } | null>;
}) {
  const resolved = use(identity);
  const [, setParams] = useQueryStates(usagePageParsers);
  if (!resolved) return null;
  return (
    <div className="flex items-center gap-2" data-testid="usage-member-filter">
      <span className="text-meta text-muted-foreground">Showing</span>
      <span className="inline-flex items-center gap-1.5 rounded-button bg-alpha-8 py-1 pl-3 pr-1.5 text-meta font-medium">
        {resolved.name || resolved.email}
        <button
          type="button"
          onClick={() => setParams({ member: null, events: null })}
          aria-label="Clear member filter"
          className="flex size-5 items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-alpha-8 hover:text-foreground"
          data-testid="usage-clear-filter"
        >
          <IconXClose className="size-3.5" aria-hidden />
        </button>
      </span>
    </div>
  );
}

// This cycle / Last cycle / Custom as one pill group. The two presets write the
// window straight to the url (a deliberate refetch). Custom is a Popover trigger,
// so clicking it only floats the range picker; it writes NOTHING, so it can't
// reload the page or shift the layout. The draft From/To live in local state and
// reach the url only when a COMPLETE, valid range is applied, in a single write.
// Hand-built (not the shared Segmented) so Last cycle can render visible-but-
// disabled with a lock + tooltip when there is no reset boundary to measure from.
function PeriodControl({
  active,
  lastCycleAvailable,
  from,
  to,
  onSelectPreset,
  onApplyCustom,
}: {
  active: PeriodKey;
  lastCycleAvailable: boolean;
  from: string | null;
  to: string | null;
  onSelectPreset: (period: Exclude<PeriodKey, 'custom'>) => void;
  onApplyCustom: (from: string, to: string) => void;
}) {
  const [draft, dispatch] = useReducer(rangeReducer, { kind: 'closed' });
  const open = draft.kind === 'editing';
  const draftFrom = draft.kind === 'editing' ? draft.from : '';
  const draftTo = draft.kind === 'editing' ? draft.to : '';
  function handleOpenChange(next: boolean) {
    dispatch(
      next
        ? { type: 'open', from: from ?? daysAgoUtc(6), to: to ?? todayUtc() }
        : { type: 'close' },
    );
  }

  const rangeValid = draftFrom !== '' && draftTo !== '' && draftFrom <= draftTo;

  function handleApply(event: FormEvent) {
    event.preventDefault();
    if (!rangeValid) return;
    onApplyCustom(draftFrom, draftTo);
    dispatch({ type: 'close' });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className="inline-flex items-center gap-1" role="group" aria-label="Usage period">
        <button
          type="button"
          aria-pressed={active === 'cycle'}
          onClick={() => onSelectPreset('cycle')}
          data-testid="usage-period-cycle"
          className={usagePeriodPillClass(active === 'cycle')}
        >
          This cycle
        </button>

        {lastCycleAvailable ? (
          <button
            type="button"
            aria-pressed={active === 'last'}
            onClick={() => onSelectPreset('last')}
            data-testid="usage-period-last"
            className={usagePeriodPillClass(active === 'last')}
          >
            Last cycle
          </button>
        ) : (
          <DelayedTooltip
            content="Last cycle needs a billing reset to compare against"
            side="bottom"
            delay={300}
          >
            {/* Disabled buttons emit no pointer events; the span senses hover. */}
            <span tabIndex={0} className="inline-flex rounded-button outline-none">
              <button
                type="button"
                aria-pressed={active === 'last'}
                disabled
                data-testid="usage-period-last"
                className={usagePeriodPillClass(active === 'last', true)}
              >
                <IconLock01 className="size-3.5" aria-hidden />
                Last cycle
              </button>
            </span>
          </DelayedTooltip>
        )}

        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={active === 'custom' || open}
            data-testid="usage-period-custom"
            className={usagePeriodPillClass(active === 'custom' || open)}
          >
            Custom
          </button>
        </PopoverTrigger>
      </div>

      {/* Portaled + floating: opening this shifts nothing in the page flow. */}
      <PopoverContent align="start" className="w-auto max-sm:w-[calc(100vw-2rem)]">
        <Form onSubmit={handleApply} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex max-sm:w-full flex-col gap-1.5 text-meta text-muted-foreground">
              From
              <Input
                type="date"
                value={draftFrom}
                max={draftTo || todayUtc()}
                onChange={(e) => dispatch({ type: 'from', value: e.target.value })}
                className="w-40 max-sm:w-full"
                data-testid="usage-from"
                // Focus follows the user's explicit action to open the range picker.
                autoFocus
              />
            </label>
            <label className="flex max-sm:w-full flex-col gap-1.5 text-meta text-muted-foreground">
              To
              <Input
                type="date"
                value={draftTo}
                min={draftFrom || undefined}
                max={todayUtc()}
                onChange={(e) => dispatch({ type: 'to', value: e.target.value })}
                className="w-40 max-sm:w-full"
                data-testid="usage-to"
              />
            </label>
          </div>
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={!rangeValid}
            data-testid="usage-apply-range"
          >
            Apply range
          </Button>
        </Form>
      </PopoverContent>
    </Popover>
  );
}
