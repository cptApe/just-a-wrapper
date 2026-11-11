'use client';
import {
  type Icon,
  IconClock,
  IconClockPlus,
  IconDatabase01,
  IconFile04,
  IconFilePlus02,
  IconFolder,
  IconFolderPlus,
  IconMessageChatCircle,
  IconMessageChatSquare,
  IconPlus,
  IconPuzzlePiece01,
  IconSettings02,
  IconUserPlus01,
  IconZap,
} from '@/components/icons';
import { CommandItem } from '@/components/ui/command';
import type { ServerSearchGroup, ServerSearchResult, StaticCommand } from '../types';

const GROUP_META: Record<ServerSearchGroup, { label: string; icon: Icon }> = {
  task: { label: 'Tasks', icon: IconMessageChatSquare },
  library: { label: 'Library', icon: IconFile04 },
  memory: { label: 'Memory', icon: IconDatabase01 },
  app: { label: 'Apps', icon: IconPuzzlePiece01 },
  skill: { label: 'Skills', icon: IconZap },
  scheduled: { label: 'Scheduled', icon: IconClock },
};

const ACTION_ICONS: Record<string, Icon> = {
  'action-new-task': IconPlus,
  'action-new-schedule': IconClockPlus,
  'action-new-note': IconFilePlus02,
  'action-new-folder': IconFolderPlus,
  'action-invite-member': IconUserPlus01,
  'action-new-workspace': IconPlus,
  'action-feedback': IconMessageChatCircle,
};

export function ResultRow({
  item,
  onNavigate,
}: {
  item: ServerSearchResult;
  onNavigate: (href: string) => void;
}) {
  const GlyphIcon = item.subtitle === 'Folder' ? IconFolder : GROUP_META[item.group].icon;
  return (
    <CommandItem
      className="h-10 min-h-10"
      value={`${item.group}-${item.id}`}
      onSelect={() => onNavigate(item.href)}
    >
      <GlyphIcon aria-hidden className="size-5 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.subtitle ? (
        <span className="ml-3 max-w-[45%] truncate text-meta text-muted-foreground">
          {item.subtitle}
        </span>
      ) : null}
    </CommandItem>
  );
}

export function StaticRow({
  command,
  onRun,
}: {
  command: StaticCommand;
  onRun: (command: StaticCommand) => void;
}) {
  const GlyphIcon =
    command.group === 'setting' ? IconSettings02 : (ACTION_ICONS[command.id] ?? IconPlus);
  return (
    <CommandItem className="h-10 min-h-10" value={command.id} onSelect={() => onRun(command)}>
      <GlyphIcon aria-hidden className="size-5 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{command.title}</span>
      {command.subtitle ? (
        <span className="ml-3 truncate text-meta text-muted-foreground">{command.subtitle}</span>
      ) : null}
    </CommandItem>
  );
}
