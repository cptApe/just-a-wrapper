'use client';
import * as React from 'react';
import { onCommandSearchOpen } from '../lib/open-search';

// App and admin search hosts never mount together; this hook owns the app’s only Cmd/Ctrl+K binding.
export function useSearchOpening(setOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  // There is no Radix DialogTrigger in the programmatic-open paths (⌘K, the
  // sidebar item), so Radix has nothing to restore focus to on close. Stash
  // the opener at open time and refocus it in onCloseAutoFocus.
  const openerRef = React.useRef<HTMLElement | null>(null);
  function stashOpener() {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  function restoreOpenerFocus(event: Event) {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  }

  // Open requests from the sidebar's Search item (window event — the item
  // lives in the shell, this host in the /app layout).
  React.useEffect(
    () =>
      onCommandSearchOpen(() => {
        stashOpener();
        setOpen(true);
      }),
    [setOpen],
  );

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => {
          // Ref write only when transitioning to open — idempotent under
          // StrictMode's double-invoked updater.
          if (!prev) stashOpener();
          return !prev;
        });
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  return { restoreOpenerFocus };
}
