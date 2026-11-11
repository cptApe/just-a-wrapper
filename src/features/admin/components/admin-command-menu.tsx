'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Modal, ModalTitle } from '@/components/ui/modal';
import { ADMIN_NAV_PAGES, adminPageHref } from '../registry';

// cmdk's own filter is off so the empty state can be rendered here.

export function AdminCommandMenu() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const router = useRouter();

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Reset AFTER the exit animation completes (the dialog exits at 400ms) so
  // every open starts clean without the list visibly refilling while the menu
  // is still fading out.
  React.useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setQuery(''), 450);
    return () => window.clearTimeout(timer);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const pages =
    needle === ''
      ? ADMIN_NAV_PAGES
      : ADMIN_NAV_PAGES.filter((page) =>
          `${page.title} ${page.purpose}`.toLowerCase().includes(needle),
        );

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      showClose={false}
      // Neutralize the enter/exit scale so the text rows don't re-rasterize a
      // pixel upward when the transform clears.
      className="h-[min(56dvh,480px)] [--tw-enter-scale:1]! [--tw-exit-scale:1]!"
    >
      <ModalTitle className="sr-only">Go to an admin page</ModalTitle>
      <Command
        shouldFilter={false}
        loop
        label="Go to an admin page"
        data-testid="admin-command-menu"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Go to"
          onClear={() => setQuery('')}
        />
        <CommandList>
          {pages.length === 0 ? (
            <p className="px-6 py-8 text-center text-body text-muted-foreground">
              No admin page matches that
            </p>
          ) : (
            <CommandGroup heading="Admin">
              {pages.map((page) => {
                const Icon = page.icon;
                return (
                  <CommandItem
                    key={page.slug}
                    value={page.slug}
                    onSelect={() => {
                      setOpen(false);
                      router.push(adminPageHref(page.slug));
                    }}
                  >
                    <Icon className="size-5 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body">{page.title}</span>
                      <span className="truncate text-meta text-muted-foreground">
                        {page.purpose}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </Modal>
  );
}
