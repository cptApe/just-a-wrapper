import type * as React from 'react';

// The one phone top bar (below md) for standard pages: the navigation button,
// the current page's name beside it, an optional action on the right. Pages
// under this bar hide their large title below md (PageHeader,
// SettingsPageHeader), so the name appears once. Home and Task render their
// own bars.
export function MobileTopBar({
  leading,
  title,
  trailing,
}: {
  leading: React.ReactNode;
  /** The current page's name; the same label the navigation shows. */
  title: string | null;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="mobile-top-inset flex min-h-12 shrink-0 items-center gap-2 px-3 md:hidden">
      {leading}
      <span
        data-testid="mobile-top-bar-title"
        className="min-w-0 flex-1 truncate text-body-lg font-medium text-foreground"
      >
        {title}
      </span>
      {trailing}
    </header>
  );
}
