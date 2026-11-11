import { formatMoney } from '@/lib/format/format-money';
import { AUTO_TOPUP } from '../pricing-config';

// An enabled top-up with a zero cap cannot buy any credits, so reject that misleading setting.
export const MIN_MONTHLY_CAP_CENTS = 100;

export type MonthlyCapChoice = { enabled: boolean; monthlyCapDollars: number };

export function monthlyCapError(choice: MonthlyCapChoice): string | null {
  if (!Number.isInteger(choice.monthlyCapDollars) || choice.monthlyCapDollars < 0) {
    return 'Enter a whole dollar amount.';
  }
  const capCents = choice.monthlyCapDollars * 100;
  if (capCents > AUTO_TOPUP.maxMonthlyCapCents) {
    return `The most you can set is ${formatMoney(AUTO_TOPUP.maxMonthlyCapCents, 'usd')} a month.`;
  }
  if (choice.enabled && capCents < MIN_MONTHLY_CAP_CENTS) {
    return `Set a monthly limit of at least ${formatMoney(MIN_MONTHLY_CAP_CENTS, 'usd')} to turn this on.`;
  }
  return null;
}
