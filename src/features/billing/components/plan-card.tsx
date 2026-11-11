'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMoney } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import {
  type CurrentPlan,
  findPack,
  isCurrentChoice,
  type PlanChoice,
  type PlanPack,
  packPrice,
  planButtonLabel,
  planLimitRows,
} from '../lib/plan-picker-packs';
import { type BillingInterval, PLANS, type PlanTier, packagesForPlan } from '../pricing-config';

// The price shown is Stripe's own price, so what the card says is what checkout charges.
export function PlanCard({
  tier,
  packs,
  interval,
  credits,
  current,
  scheduled,
  busy,
  working,
  onCreditsChange,
  onChoose,
}: {
  tier: PlanTier;
  packs: readonly PlanPack[];
  interval: BillingInterval;
  credits: number;
  current: CurrentPlan | null;
  scheduled: PlanChoice | null;
  busy: boolean;
  working: boolean;
  onCreditsChange: (credits: number) => void;
  onChoose: (choice: PlanChoice) => void;
}) {
  const plan = PLANS[tier];
  const choice = { tier, interval, credits };
  const pack = findPack(packs, choice);
  const price = pack ? packPrice(pack) : null;
  const isCurrentPackage = isCurrentChoice(current, choice);
  const isScheduled =
    scheduled !== null &&
    scheduled.tier === tier &&
    scheduled.interval === interval &&
    scheduled.credits === credits;

  return (
    <Card className="flex flex-col gap-5 p-5" data-tier={tier}>
      <div className="flex flex-col gap-1">
        <h3 className="flex items-baseline justify-between gap-3 text-title-card">
          {plan.name}
          {current?.tier === tier ? (
            <span className="text-meta text-muted-foreground">Your plan</span>
          ) : null}
        </h3>
        <p className="text-meta text-muted-foreground">{plan.description}</p>
      </div>

      <div className="min-h-12">
        {price && pack ? (
          <>
            <p className="text-title-section tabular-nums">
              {formatMoney(price.monthlyCents, pack.currency)}
              <span className="text-meta text-muted-foreground"> a month</span>
            </p>
            {price.yearlyTotalCents !== null ? (
              <p className="text-meta text-muted-foreground tabular-nums">
                Billed {formatMoney(price.yearlyTotalCents, pack.currency)} a year
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-body text-muted-foreground">Not for sale right now</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-meta text-muted-foreground" id={`plan-credits-${tier}`}>
          Credits each month
        </span>
        <Select
          value={String(credits)}
          disabled={busy}
          onValueChange={(value) => onCreditsChange(Number(value))}
        >
          <SelectTrigger aria-labelledby={`plan-credits-${tier}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {packagesForPlan(tier).map((amount) => (
              <SelectItem
                key={amount}
                value={String(amount)}
                disabled={!findPack(packs, { tier, interval, credits: amount })}
              >
                {formatCount(amount)} credits
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <dl className="flex flex-1 flex-col gap-2 text-body">
        {planLimitRows(plan.limits).map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>

      <Button
        type="button"
        variant={isCurrentPackage || isScheduled ? 'secondary' : 'primary'}
        className="w-full"
        disabled={!pack || isCurrentPackage || isScheduled || busy}
        onClick={() => onChoose(choice)}
      >
        {planButtonLabel({
          planName: plan.name,
          current,
          isCurrentPackage,
          isScheduled,
          tier,
          working,
        })}
      </Button>
    </Card>
  );
}
