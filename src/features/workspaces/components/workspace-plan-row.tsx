'use client';

import Link from 'next/link';
import { rowActionClass } from '@/components/settings/row-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import { cn } from '@/lib/utils';

// Workspace plan card pairs a plan badge and sentence with the permitted action.
// Add credits opens the one credit purchase, or the plan dialog where plans are sold; admins can
// manage an existing plan.
// Members see no billing action. The skeleton shares the card geometry.

export type PlanAction = 'credits' | 'plans' | 'manage' | null;

const BILLING_HREF = '/app/settings/billing';

// The contained surface: raised fill + hairline border, comfortable inner
// padding, full reading-column width (it lives in the items-start hero cluster,
// so it must stretch itself). This is the one bordered card on the page; every
// other section is borderless (spec 08 elevation-by-fill), so it reads as the
// emphasized surface.
// On phones the action drops below the plan text, flush with its left edge,
// so the sentence keeps the full card width.
const containerClass =
  'flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4 max-sm:flex-col max-sm:items-start max-sm:gap-2';
const leftColClass = 'flex min-w-0 flex-col items-start gap-2';

export function WorkspacePlanRow({
  badge,
  sentence,
  action,
}: {
  /** Uppercase plan name for the badge pill (PRO / MAX); null hides the pill (no plan, or a billing error). */
  badge: string | null;
  sentence: string;
  action: PlanAction;
}) {
  return (
    <div className={containerClass}>
      <div className={leftColClass}>
        {badge ? (
          <Badge shape="pill" variant="solid">
            {badge}
          </Badge>
        ) : null}
        <span className="text-body text-muted-foreground">{sentence}</span>
      </div>
      {action === 'credits' ? (
        <Button
          type="button"
          variant="primary"
          className="shrink-0"
          onClick={() => openOverlay('topup')}
        >
          Add credits
        </Button>
      ) : action === 'plans' ? (
        <Button
          type="button"
          variant="primary"
          className="shrink-0"
          onClick={() => openOverlay('plans')}
        >
          Choose a plan
        </Button>
      ) : action === 'manage' ? (
        <Link href={BILLING_HREF} className={cn(rowActionClass(), 'shrink-0')}>
          Manage plan
        </Link>
      ) : null}
    </div>
  );
}

// Loading twin for an admin on a paid plan: the badge pill, the one-line
// sentence, and the Manage plan link, inside the same card.
export function WorkspacePlanRowSkeleton() {
  return (
    <div className={containerClass}>
      <div className={leftColClass}>
        <Badge aria-hidden shape="pill" variant="muted" className="animate-pulse text-transparent">
          PRO
        </Badge>
        <span className="text-body text-muted-foreground">
          <SkeletonText>
            You’re on the Pro plan. 5,000 credits a month. Renewing on December 1, 2026.
          </SkeletonText>
        </span>
      </div>
      <span aria-hidden className={cn(rowActionClass(), 'shrink-0')}>
        Manage plan
      </span>
    </div>
  );
}
