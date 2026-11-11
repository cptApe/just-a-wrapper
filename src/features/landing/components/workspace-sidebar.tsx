import { home } from '@content/home';
import {
  type Icon,
  IconBell01,
  IconChevronDown,
  IconLayoutLeft,
  IconSearchMd,
} from '@/components/icons';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CountBadge } from '@/components/ui/count-badge';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { newTaskNav, primaryNav } from '@/features/shell/lib/nav';
import { brand } from '@/lib/brand/identity';
import { cn } from '@/lib/utils';
import { TASK_RUN } from './workspace-timing';

const copy = home.workspace;

const NAV_ROWS: { label: string; icon: Icon }[] = [
  newTaskNav,
  ...primaryNav,
  { label: copy.notifications, icon: IconBell01 },
  { label: copy.search, icon: IconSearchMd },
];

const NAV_ROW_CLASS =
  'flex h-11 items-center gap-3 rounded-button px-3 font-medium text-body-lg text-foreground/80';

/** The expanded desktop sidebar, row for row. Phones have none, like the app. */
export function WorkspaceSidebar() {
  return (
    <div className="hidden w-[var(--sidebar-w)] shrink-0 flex-col overflow-hidden border-border border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 shrink-0 items-center gap-1 px-2">
        <span className="flex min-w-0 items-center gap-2.5 px-1.5 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-alpha-12 font-semibold text-foreground text-title-card">
            {brand.name.charAt(0).toUpperCase()}
          </span>
          <span className="truncate font-semibold text-body-lg tracking-tight">{brand.name}</span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </span>
        <span className="ml-auto grid size-11 shrink-0 place-items-center">
          <IconLayoutLeft className="size-5" />
        </span>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 px-2 pb-0.5">
        {NAV_ROWS.map(({ label, icon: RowIcon }) => (
          <span key={label} className={NAV_ROW_CLASS}>
            <RowIcon className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {label === copy.search ? (
              <KbdGroup className="shrink-0">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
            ) : null}
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-2">
        <p className="mt-4 flex h-8 items-center px-2.5 font-semibold text-foreground text-title-card">
          {copy.recents}
        </p>
        <ul className="flex flex-col gap-0.5">
          <TaskRow title={copy.activeTask} status="this-run" active />
          {copy.otherTasks.map((task) => (
            <TaskRow key={task.title} title={task.title} status={task.status} />
          ))}
        </ul>
      </div>

      <div className="shrink-0 px-2 pt-2 pb-3">
        <div className="flex h-11 items-center gap-2.5 px-2">
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-meta">{initials(copy.userName)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate font-normal text-foreground/70 text-meta">
            {copy.userName}
          </span>
        </div>
      </div>
    </div>
  );
}

type TaskRowStatus = 'this-run' | 'running' | 'unread';

function TaskRow({
  title,
  status,
  active = false,
}: {
  title: string;
  status: TaskRowStatus;
  active?: boolean;
}) {
  return (
    <li className="relative">
      <span
        className={cn(
          'flex h-10 items-center rounded-md px-2.5 pr-11 text-body',
          active ? 'bg-alpha-12 text-foreground' : 'text-foreground/80',
        )}
      >
        <span className="truncate">{title}</span>
      </span>
      <span className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center">
        <StatusGlyph status={status} />
      </span>
    </li>
  );
}

// The spinner and the unread badge copy statusGlyph in the shell's task row.
function StatusGlyph({ status }: { status: TaskRowStatus }) {
  switch (status) {
    case 'this-run':
      return (
        <span style={TASK_RUN} className="landing-beat opacity-0">
          <Spinner />
        </span>
      );
    case 'running':
      return <Spinner />;
    case 'unread':
      return <CountBadge count={1} className="size-[18px] min-w-[18px]" />;
  }
}

function Spinner() {
  return (
    <span className="block size-[18px] animate-spin rounded-full border-2 border-alpha-12 border-t-info-strong" />
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2);
}
