// Table frame for the usage log, shared by the real table and its loading twin
// so the columns cannot drift. Layout classes only; each site adds its own text
// color. Server-safe (no 'use client').

export const LOG_TABLE = 'w-full min-w-[560px] text-body';
export const LOG_ROW = 'border-b border-border/60';
export const LOG_DAY_CELL = 'pb-1.5 pt-5 text-meta text-muted-foreground';
export const LOG_TIME_CELL = 'whitespace-nowrap py-2.5 pr-4';
export const LOG_TYPE_CELL = 'whitespace-nowrap py-2.5 pr-4';
export const LOG_TASK_CELL = 'w-full max-w-0 py-2.5 pr-4';
export const LOG_MEMBER_CELL = 'max-w-0 truncate py-2.5 pr-4';
export const LOG_CREDITS_CELL = 'py-2.5 text-right';

export function UsageLogHead({ showMember }: { showMember: boolean }) {
  return (
    <thead>
      <tr className="border-b border-border text-meta text-muted-foreground">
        <th className="w-24 py-2 pr-4 text-left font-medium">When</th>
        <th className="w-36 py-2 pr-4 text-left font-medium">Type</th>
        <th className="py-2 pr-4 text-left font-medium">Task</th>
        {showMember ? <th className="w-44 py-2 pr-4 text-left font-medium">Member</th> : null}
        <th className="w-28 whitespace-nowrap py-2 text-right font-medium">Credits used</th>
      </tr>
    </thead>
  );
}
