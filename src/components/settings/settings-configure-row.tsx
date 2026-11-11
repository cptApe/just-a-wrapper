// These controls apply immediately; edits that need Save belong in SettingsDetailRow.
export function SettingsConfigureRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  /** One short sentence under the label. */
  description?: string;
  /** id of the control in the slot, to make the label focus it. */
  htmlFor?: string;
  /** The control slot (Switch / Segmented / select / value). */
  children: React.ReactNode;
}) {
  const LabelTag = htmlFor ? 'label' : 'span';
  return (
    <div className="flex flex-col items-start gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body font-semibold">
          <LabelTag htmlFor={htmlFor}>{label}</LabelTag>
        </span>
        {description ? (
          <span className="text-meta text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
