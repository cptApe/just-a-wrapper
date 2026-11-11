import type * as React from 'react';
export function ScheduleFormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h3 className="text-meta font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
