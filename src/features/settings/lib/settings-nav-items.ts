import {
  type Icon,
  IconBarChart05,
  IconBell01,
  IconBuilding02,
  IconCreditCard01,
  IconSettings01,
  IconUser01,
  IconUsers01,
} from '@/components/icons';

// The settings rail's destinations, grouped into personal and workspace
// settings. Hiding Billing is navigation UX; the server enforces authorization.
// The phone top bar reads its page name from the same list.
export type SettingsNavItem = {
  label: string;
  href: string;
  icon: Icon;
  adminOnly?: boolean;
  needsBilling?: boolean;
};

export const settingsNavGroups: { label: string; items: SettingsNavItem[] }[] = [
  {
    label: 'Personal',
    items: [
      { label: 'Account', href: '/app/settings/account', icon: IconUser01 },
      { label: 'General', href: '/app/settings/general', icon: IconSettings01 },
      { label: 'Notifications', href: '/app/settings/notifications', icon: IconBell01 },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Workspace', href: '/app/settings/workspace', icon: IconBuilding02 },
      { label: 'Members', href: '/app/settings/members', icon: IconUsers01 },
      { label: 'Usage', href: '/app/settings/usage', icon: IconBarChart05, needsBilling: true },
      {
        label: 'Billing',
        href: '/app/settings/billing',
        icon: IconCreditCard01,
        adminOnly: true,
        needsBilling: true,
      },
    ],
  },
];

/** True when the pathname is this settings destination or one of its subpages. */
export function isSettingsItemActive(item: SettingsNavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The phone top bar's page name: the active rail item's label, or
    "Settings" when no rail item owns the route. */
export function settingsPageTitle(pathname: string): string {
  for (const group of settingsNavGroups) {
    const item = group.items.find((candidate) => isSettingsItemActive(candidate, pathname));
    if (item) return item.label;
  }
  return 'Settings';
}
