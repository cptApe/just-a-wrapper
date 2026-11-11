import {
  CHARGE_COLUMNS,
  CHARGE_FOOTNOTE,
  chargeRows,
  chargesExplained,
} from '../../lib/charge-rows';

// Put provider price and customer credits side by side so their relationship can be compared.
export function PricingAdminCharges() {
  const rows = chargeRows();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {chargesExplained().map((sentence) => (
          <p key={sentence} className="text-pretty text-body text-muted-foreground">
            {sentence}
          </p>
        ))}
      </div>
      <div
        aria-hidden
        className="hidden items-baseline gap-6 pt-2 text-meta text-muted-foreground sm:flex"
      >
        <span className="min-w-0 flex-1" />
        <span className="w-64 text-right">{CHARGE_COLUMNS.vendorRate}</span>
        <span className="w-44 text-right">{CHARGE_COLUMNS.credits}</span>
        <span className="w-28 text-right">{CHARGE_COLUMNS.customerPaid}</span>
      </div>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:gap-6"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-title-card">{row.label}</span>
              <span className="text-pretty text-meta text-muted-foreground">{row.detail}</span>
            </div>
            <span className="text-meta tabular-nums text-muted-foreground sm:w-64 sm:text-right">
              {row.vendorRate}
            </span>
            <span className="text-body font-medium tabular-nums sm:w-44 sm:text-right">
              {row.credits}
            </span>
            <span className="text-meta tabular-nums text-muted-foreground sm:w-28 sm:text-right">
              {row.customerPaid}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-meta text-muted-foreground">{CHARGE_FOOTNOTE}</p>
    </div>
  );
}
