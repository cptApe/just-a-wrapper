export function AdminSection({
  id,
  title,
  support,
  action,
  children,
}: {
  /** Fixed anchor for the table of contents. Omit and the TOC derives one from
      the title, which is fine unless something links to this section by hash. */
  id?: string;
  title: string;
  support?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    // aria-labelledby keeps the section exposed as a named region landmark; a
    // bare <section> is no landmark at all.
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="flex min-w-0 flex-col gap-1">
          {/* scroll-mt-24 clears the sticky admin header when the TOC jumps here. */}
          <h2 id={id} className="scroll-mt-24 text-title-section">
            {title}
          </h2>
          {support ? <p className="text-body text-muted-foreground">{support}</p> : null}
        </div>
        {/* The negative margin keeps a 44px button from growing the 24px heading row. */}
        {action ? <div className="shrink-0 sm:-my-2.5">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
