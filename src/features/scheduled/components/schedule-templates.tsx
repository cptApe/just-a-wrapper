'use client';

// Templates only prefill the draft; opening one must never create a task before Save.

import { useState } from 'react';
import { IconClock } from '@/components/icons';
import { useConnectedAppsEnabled } from '@/components/providers/deployment-capabilities-provider';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { PillTabs } from '@/components/ui/pill-tabs';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { buildCron } from '@/features/tasks/lib/build-cron';
import { shortCadence } from '@/features/tasks/lib/short-cadence';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { cn } from '@/lib/utils';
import { SCHEDULE_TEMPLATES } from '../lib/templates';
import { ScheduleIcon, scheduleIconColor } from './schedule-icon';

const CATEGORIES = ['All', 'News', 'Productivity', 'Finance', 'Research', 'Lifestyle'] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_OPTIONS = CATEGORIES.map((value) => ({ value, label: value }));

export function ScheduleTemplates({ defaultTimezone }: { defaultTimezone: string | null }) {
  const [category, setCategory] = useState<Category>('All');
  const connectedAppsEnabled = useConnectedAppsEnabled();
  const { timeFormat } = useDisplayFormat();
  const templates = SCHEDULE_TEMPLATES.filter(
    (template) => category === 'All' || template.category === category,
  );
  return (
    <section aria-labelledby="schedule-templates-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="schedule-templates-heading"
          className="text-title-card font-semibold text-muted-foreground"
        >
          Templates
        </h3>
        <PillTabs
          value={category}
          options={CATEGORY_OPTIONS}
          onChange={setCategory}
          label="Template categories"
        />
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {templates.map((template) => {
          const needsConnectedApps = template.draft.mode === 'event' && !connectedAppsEnabled;
          return (
            <li key={template.id} className="min-w-0">
              <button
                type="button"
                disabled={needsConnectedApps}
                aria-label={
                  needsConnectedApps
                    ? `${template.title}. ${CAPABILITY_OFF_MESSAGES.connectedApps}`
                    : `Add ${template.title}`
                }
                onClick={() =>
                  openOverlay(
                    buildOverlayHash('new-schedule', null, {
                      template: template.id,
                      ...(defaultTimezone ? { tz: defaultTimezone } : {}),
                    }),
                  )
                }
                // Phone: one compact row (icon, text, Add) instead of a tall
                // card, so a few templates fit on screen at once.
                className="flex size-full min-w-0 flex-col rounded-lg border border-border/50 bg-alpha-3 p-4 text-left transition-colors enabled:hover:bg-alpha-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:px-3.5 max-sm:py-3"
              >
                <div className="mb-4 flex w-full items-start justify-between max-sm:contents">
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md text-on-media max-sm:self-start',
                      scheduleIconColor(template.icon),
                    )}
                  >
                    <ScheduleIcon
                      icon={template.icon}
                      triggerType={template.draft.mode}
                      className="size-4"
                    />
                  </span>
                  {!needsConnectedApps && (
                    <span
                      aria-hidden
                      className="inline-flex h-8 shrink-0 items-center rounded-full bg-popover px-3.5 text-meta font-medium inset-shadow-[0_0_0_1px_var(--color-alpha-16)] max-sm:order-last"
                    >
                      Add
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-col max-sm:flex-1">
                  <span className="text-meta font-semibold">{template.title}</span>
                  <span className="mt-1 line-clamp-2 min-h-8 text-meta font-normal text-muted-foreground max-sm:min-h-0">
                    {template.blurb}
                  </span>
                  <span className="mt-3 flex items-center gap-1.5 text-meta font-normal text-muted-foreground max-sm:mt-1.5">
                    <IconClock className="size-3 shrink-0" />
                    {needsConnectedApps
                      ? CAPABILITY_OFF_MESSAGES.connectedApps
                      : template.draft.mode === 'event'
                        ? 'When a new email arrives'
                        : shortCadence(buildCron(template.draft.schedule) ?? '', timeFormat)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
