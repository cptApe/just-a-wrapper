import { formatDate } from '@/lib/format/format-date';
import { formatMoney } from '@/lib/format/format-money';
import type { PaymentHistoryEntry } from '../api/list-payment-history';

export type PaymentHistoryRow = {
  id: string;
  dateLabel: string;
  description: string;
  amountLabel: string;
  receiptUrl: string | null;
};

// Formatted on the server in the reader's zone; the client "Show more" list only renders strings.
export function toPaymentHistoryRow(
  entry: PaymentHistoryEntry,
  timeZone: string,
): PaymentHistoryRow {
  return {
    id: entry.id,
    dateLabel: formatDate(entry.date, timeZone),
    description: entry.description,
    amountLabel: formatMoney(entry.amountCents, entry.currency),
    receiptUrl: entry.receiptUrl,
  };
}
