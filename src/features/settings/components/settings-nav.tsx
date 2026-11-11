'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItemClasses } from '@/components/layouts/nav-item-classes';
import { useBillingEnabled } from '@/components/providers/deployment-capabilities-provider';
import { isSettingsItemActive, settingsNavGroups } from '../lib/settings-nav-items';

export function SettingsNav({
  isAdmin,
  onNavigate,
}: {
  /** When false, admin-only destinations (Billing) are hidden from the rail. */
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const billingEnabled = useBillingEnabled();
  return (
    <nav aria-label="Settings sections">
      {settingsNavGroups.map((group, index) => (
        <div key={group.label} className={index > 0 ? 'pt-6' : undefined}>
          <div className="px-3 pb-1 text-meta font-medium text-foreground-tertiary">
            {group.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.items
              .filter(
                (item) => (!item.adminOnly || isAdmin) && (!item.needsBilling || billingEnabled),
              )
              .map((item) => {
                const active = isSettingsItemActive(item, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={navItemClasses(active)}
                    >
                      <Icon className="size-5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
