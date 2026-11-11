import { IconLinkExternal01 } from '@/components/icons';

import {
  billSummaryLabels,
  billTotals,
  COST_SCALE_COLUMNS,
  customersToCover,
  keptPerSubscriptionSentence,
  NO_VENDOR_BILLS,
  vendorBillRows,
  vendorBillsIntro,
} from '../../lib/vendor-bill-rows';

// Show three business sizes so operators can see how bills grow and replace estimates from vendor pricing links.
export function PricingAdminVendorBills() {
  const rows = vendorBillRows();

  if (rows.length === 0) {
    return <p className="text-body text-muted-foreground">{NO_VENDOR_BILLS}</p>;
  }

  const totals = billTotals();
  const cover = customersToCover();
  const labels = billSummaryLabels();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {vendorBillsIntro().map((sentence) => (
          <p key={sentence} className="text-pretty text-body text-muted-foreground">
            {sentence}
          </p>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-2xl border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-3 pr-6 text-meta font-normal text-muted-foreground">
                <span className="sr-only">What the bill is for</span>
              </th>
              {COST_SCALE_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="w-40 py-3 pr-6 text-right align-bottom text-meta font-normal text-muted-foreground last:pr-0"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-border">
                <th scope="row" className="py-3.5 pr-6 align-top font-normal">
                  <a
                    href={row.pricingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 text-title-card underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {row.name}
                    <IconLinkExternal01 aria-hidden className="size-3.5 text-muted-foreground" />
                  </a>
                  <span className="block text-pretty text-meta text-muted-foreground">
                    {row.role}
                  </span>
                  <span className="block text-pretty text-meta text-muted-foreground">
                    {row.grows}
                  </span>
                </th>
                {COST_SCALE_COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className="py-3.5 pr-6 text-right align-top text-body tabular-nums last:pr-0"
                  >
                    {row.valuesByScale[column.key]}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-b border-border">
              <th scope="row" className="py-3.5 pr-6 text-body font-medium">
                {labels.total}
              </th>
              {COST_SCALE_COLUMNS.map((column) => (
                <td
                  key={column.key}
                  className="py-3.5 pr-6 text-right text-body font-medium tabular-nums last:pr-0"
                >
                  {totals[column.key].money}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="py-3.5 pr-6 text-meta font-normal text-muted-foreground sm:whitespace-nowrap"
              >
                {labels.cover}
              </th>
              {COST_SCALE_COLUMNS.map((column) => (
                <td
                  key={column.key}
                  className="py-3.5 pr-6 text-right text-body tabular-nums last:pr-0"
                >
                  {cover[column.key]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-pretty text-meta text-muted-foreground">{keptPerSubscriptionSentence()}</p>
    </div>
  );
}
