'use client';

import { upstreamAhead } from '@content/changelog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItemClasses } from '@/components/layouts/nav-item-classes';
import { cn } from '@/lib/utils';
import { ADMIN_NAV_PAGES, type AdminPageMeta, adminPageHref, isAdminPageActive } from '../registry';

const GROUP_LABELS: Record<AdminPageMeta['group'], string> = {
  general: 'General',
  configure: 'Configure',
  understand: 'Understand',
};

export function AdminNav({
  forkVersion,
  onNavigate,
}: {
  forkVersion: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const updatesAvailable = upstreamAhead(forkVersion);
  return (
    <nav aria-label="Admin sections">
      {Object.entries(GROUP_LABELS).map(([group, label], index) => {
        const pages = ADMIN_NAV_PAGES.filter((page) => page.group === group);
        if (pages.length === 0) return null;

        return (
          <div key={group} className={index > 0 ? 'pt-6' : undefined}>
            <div className="px-3 pb-1 text-meta font-medium text-foreground-tertiary">{label}</div>
            <ul className="flex flex-col gap-0.5">
              {pages.map((page) => {
                const active = isAdminPageActive(pathname, page.slug);
                const Icon = page.icon;
                return (
                  <li key={page.slug}>
                    <Link
                      href={adminPageHref(page.slug)}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={navItemClasses(active)}
                    >
                      <Icon className="size-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{page.title}</span>
                      {/* Lit while the changelog names a release newer than this build. */}
                      {page.slug === 'updates' ? (
                        <>
                          <span
                            aria-hidden
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              updatesAvailable && 'bg-primary',
                            )}
                          />
                          {updatesAvailable ? (
                            <span className="sr-only">Upstream updates available</span>
                          ) : null}
                        </>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
