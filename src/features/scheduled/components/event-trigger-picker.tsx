'use client';

// Only catalog triggers on connected accounts are offered; other events cannot run server-side.

import Link from 'next/link';
import * as React from 'react';
import { IconAlertTriangle, IconCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IntegrationLogo } from '@/features/integrations/components/integration-logo';
import { EVENT_TRIGGER_CATALOG } from '@/features/tasks/constants';
import type { EventSelection } from '@/features/tasks/types';
import { cn } from '@/lib/utils';
import { useTriggerConnections } from '../api/use-trigger-connections';

export function EventTriggerPicker({
  value,
  onChange,
  preferredEventType,
}: {
  value: EventSelection | null;
  onChange: (value: EventSelection) => void;
  /** A template's trigger: auto-selected when connected, else the first available. */
  preferredEventType: string | null;
}) {
  const { state, retry } = useTriggerConnections();

  const available = React.useMemo(
    () =>
      state.kind === 'ready'
        ? EVENT_TRIGGER_CATALOG.filter((event) => state.connected.has(event.toolkit))
        : [],
    [state],
  );

  // Auto-select so the mode is submittable without an extra tap: the template's
  // preferred trigger when it is connected, otherwise the first available one.
  React.useEffect(() => {
    if (value !== null || available.length === 0) return;
    const preferred = available.find((event) => event.eventType === preferredEventType);
    const pick = preferred ?? available.at(0);
    if (pick) onChange({ toolkit: pick.toolkit, eventType: pick.eventType });
  }, [available, value, onChange, preferredEventType]);

  const connectLink = (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning-soft p-3 text-warning">
      <span className="flex items-center gap-2 text-body">
        <IconAlertTriangle className="size-5" />
        Connect Gmail to run this schedule
      </span>
      <Button asChild type="button" variant="secondary" size="sm">
        <Link href="/app/tools#app/gmail">Connect Gmail</Link>
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => void retry()}>
        Check connection
      </Button>
    </div>
  );

  if (state.kind === 'loading') {
    return (
      <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Checking your apps">
        <div className="flex min-h-14 items-center gap-3 rounded-lg bg-alpha-3 px-3">
          <Skeleton className="size-10 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <p role="alert" className="text-title-card text-muted-foreground">
          Couldn’t check which apps are connected.
        </p>
        <Button type="button" variant="secondary" onClick={() => void retry()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Event">
      <div className="space-y-3 overflow-hidden rounded-lg border border-border p-2">
        <div className="flex min-h-11 items-center gap-3 border-b border-border px-2 pb-2 pr-10">
          <IntegrationLogo slug="gmail" name="Gmail" logoUrl={null} size={36} />
          <span className="text-title-card text-muted-foreground">New email</span>
        </div>
        <p className="px-2 py-1 text-body leading-6 text-muted-foreground">
          Runs for every new email in your inbox. Say in Instructions which emails matter and which
          to ignore.
        </p>
        {available.map((event) => {
          const app = state.connected.get(event.toolkit);
          const selected = value?.eventType === event.eventType && value.toolkit === event.toolkit;
          return (
            <button
              key={event.eventType}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ toolkit: event.toolkit, eventType: event.eventType })}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left',
                'transition-[background-color] duration-150 ease-[var(--ease-out)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                selected
                  ? 'bg-schedule-review-pass text-on-media'
                  : 'bg-schedule-blue text-on-media',
              )}
            >
              <IntegrationLogo
                logoUrl={app?.logoUrl ?? null}
                name={app?.name ?? event.toolkit}
                slug={event.toolkit}
                size={40}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body text-on-media">{event.label}</span>
                <span className="truncate text-meta font-normal text-on-media">
                  Gmail is connected
                </span>
              </span>
              {/* The check always holds its box so selecting never reflows the row. */}
              <IconCheck
                aria-hidden
                className={cn('size-5 shrink-0 text-on-media', !selected && 'opacity-0')}
              />
            </button>
          );
        })}
        {available.length === 0 ? connectLink : null}
      </div>
    </div>
  );
}
