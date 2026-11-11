'use client';

import * as React from 'react';
import { IconChevronRight, IconFolder } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { isWithin, parentPath, ROOT } from '../lib/paths';
import type { FolderEntry } from '../types';

// Navigate the loaded folder tree without fetching. Disable the moved folder
// and its descendants so it cannot move inside itself.

export function MoveModal({
  folders,
  disabledSubtrees,
  itemLabel,
  busy,
  onMove,
  onOpenChange,
}: {
  folders: FolderEntry[];
  /** Folder paths being moved — they and their subtrees are invalid targets. */
  disabledSubtrees: string[];
  /** "3 items" / "report.pdf" — the modal title suffix. */
  itemLabel: string;
  busy: boolean;
  onMove: (targetPath: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = React.useState(ROOT);

  const children = folders
    .filter((f) => f.path !== ROOT && parentPath(f.path) === current)
    .sort((a, b) => a.name.localeCompare(b.name));

  const crumbs = [{ name: 'Files', path: ROOT }].concat(
    current === ROOT
      ? []
      : current
          .slice(1)
          .split('/')
          .map((seg, i, all) => ({ name: seg, path: `/${all.slice(0, i + 1).join('/')}` })),
  );

  const currentDisabled = disabledSubtrees.some((p) => isWithin(p, current));

  return (
    <Modal open onOpenChange={onOpenChange} size="sm">
      <ModalHeader>
        <ModalTitle>Move {itemLabel}</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !currentDisabled) onMove(current);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent className="flex min-h-[280px] flex-col gap-3">
          <nav
            className="flex flex-wrap items-center gap-1 text-meta"
            aria-label="Move target path"
          >
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                {i > 0 && (
                  <IconChevronRight className="size-3.5 text-foreground-tertiary" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => setCurrent(c.path)}
                  className={cn(
                    'rounded-md px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    i === crumbs.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
          <ul className="flex flex-col">
            {children.length === 0 ? (
              <li className="px-2 py-6 text-center text-meta text-muted-foreground">
                No folders in here.
              </li>
            ) : (
              children.map((folder) => {
                const disabled = disabledSubtrees.some((p) => isWithin(p, folder.path));
                return (
                  <li key={folder.path}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setCurrent(folder.path)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-title-card text-foreground',
                        'hover:bg-alpha-6 disabled:opacity-40 disabled:hover:bg-transparent',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                    >
                      <IconFolder className="size-4 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      <IconChevronRight className="size-3.5 text-foreground-tertiary" aria-hidden />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || currentDisabled} aria-busy={busy}>
            Move here
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
