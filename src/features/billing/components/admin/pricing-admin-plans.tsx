import { packageRows, planColumns, planNotes, planTableRows } from '../../lib/pricing-admin-model';

// Compare plan limits in a table because both plans charge the same price per credit.
export function PricingAdminPlans() {
  const columns = planColumns();
  const rows = planTableRows();
  const packages = packageRows();
  const notes = planNotes();

  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-x-auto">
        <table className="w-full min-w-md border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-3 pr-6 text-meta font-normal text-muted-foreground">
                <span className="sr-only">What the plan gives</span>
              </th>
              {columns.map((column) => (
                <th key={column.tier} scope="col" className="py-3 pr-6 last:pr-0 align-bottom">
                  <span className="block text-title-card">{column.name}</span>
                  <span className="block text-meta font-normal text-muted-foreground">
                    {column.description}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-3.5 pr-6 text-meta font-normal text-muted-foreground">
                  {row.label}
                </th>
                {columns.map((column) => (
                  <td key={column.tier} className="py-3.5 pr-6 text-body tabular-nums last:pr-0">
                    {row.valuesByTier[column.tier]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-title-card">Credit packages</h3>
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {packages.map((row) => (
            <li key={row.credits} className="flex items-baseline justify-between gap-6 py-3">
              <span className="text-body tabular-nums">{row.creditsLabel}</span>
              <span className="flex items-baseline gap-4">
                <span className="text-meta text-muted-foreground">{row.plans}</span>
                <span className="w-36 shrink-0 text-right text-body font-medium tabular-nums">
                  {row.monthlyPrice}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {notes.map((note) => (
          <p key={note} className="text-meta text-muted-foreground">
            {note}
          </p>
        ))}
      </div>
    </div>
  );
}
