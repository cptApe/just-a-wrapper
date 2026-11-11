'use client';

import { useState } from 'react';

import { readSidebarCookie, writeSidebarCookie } from '../lib/sidebar-cookies';

// Persist + restore a section's open-state. The cookie is the source of truth: a
// section can unmount and remount within a session (Pinned disappears when the
// last pin is removed, Team when the last shared task leaves), and the SSR prop
// would re-seed a stale value if the user re-toggled meanwhile. During hydration
// the cookie and the prop agree, so this can't mismatch.
export function useSectionOpen(cookie: string, initialOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => readSidebarCookie(cookie) ?? initialOpen);
  function toggleOpen() {
    setOpen((prev) => {
      writeSidebarCookie(cookie, !prev);
      return !prev;
    });
  }
  return [open, toggleOpen];
}
