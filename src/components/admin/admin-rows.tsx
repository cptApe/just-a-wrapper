export function AdminRowList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="flex flex-col divide-y divide-border border-y border-border">{children}</dl>
  );
}

/** Label left, value right. For a figure the eye scans down a column. */
export function AdminValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3.5">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="text-right text-body font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Label first, then the sentence that says what it means for a customer. */
export function AdminRuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3.5 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="text-title-card sm:w-52 sm:shrink-0">{label}</dt>
      <dd className="text-pretty text-meta text-muted-foreground">{value}</dd>
    </div>
  );
}
