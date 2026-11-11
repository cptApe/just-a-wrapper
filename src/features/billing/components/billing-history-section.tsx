'use client';

import { useState } from 'react';
import { RowAction, rowActionClass } from '@/components/settings/row-action';
import type { PaymentHistoryRow } from '../lib/payment-history-row';

// Extra payments are already in props; Show more must not fetch a second page.
const INITIAL_VISIBLE = 12;

// The page owns the loading skeleton; null is a failed read, an empty list is no payments, and rows are success.
export function BillingHistorySection({ rows }: { rows: PaymentHistoryRow[] | null }) {
  const [expanded, setExpanded] = useState(false);

  if (rows === null) {
    return (
      <p className="text-body text-muted-foreground" role="alert">
        Couldn&apos;t load payment history right now
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="text-body text-muted-foreground">No payments yet</p>;
  }

  const hasMore = rows.length > INITIAL_VISIBLE;
  const visible = expanded ? rows : rows.slice(0, INITIAL_VISIBLE);

  return (
    <div className="flex flex-col">
      {visible.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body">{row.description}</span>
            <span className="text-meta text-muted-foreground tabular-nums">{row.dateLabel}</span>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="text-body tabular-nums">{row.amountLabel}</span>
            {row.receiptUrl ? (
              <a
                href={row.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={rowActionClass()}
              >
                Receipt
              </a>
            ) : null}
          </div>
        </div>
      ))}

      {hasMore ? (
        <div className="pt-3">
          <RowAction aria-expanded={expanded} onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? 'Show less' : 'Show more'}
          </RowAction>
        </div>
      ) : null}
    </div>
  );
}
