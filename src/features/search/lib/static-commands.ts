import type { StaticCommand } from '../types';

const SETTINGS_COMMANDS: readonly StaticCommand[] = [
  setting('general', 'General'),
  setting('account', 'Account'),
  setting('members', 'Members'),
  setting('billing', 'Billing'),
  setting('usage', 'Usage'),
  setting('notifications', 'Notifications'),
  setting('workspace', 'Workspace'),
];

function setting(slug: string, title: string): StaticCommand {
  return {
    group: 'setting',
    id: `setting-${slug}`,
    title,
    subtitle: 'Settings',
    action: { type: 'navigate', href: `/app/settings/${slug}` },
  };
}

const BILLING_COMMAND_IDS = new Set(['setting-billing', 'setting-usage']);

export function availableSettingsCommands(billingEnabled: boolean): readonly StaticCommand[] {
  return billingEnabled
    ? SETTINGS_COMMANDS
    : SETTINGS_COMMANDS.filter((command) => !BILLING_COMMAND_IDS.has(command.id));
}

export const ACTION_COMMANDS: readonly StaticCommand[] = [
  {
    group: 'action',
    id: 'action-new-task',
    title: 'New task',
    action: { type: 'navigate', href: '/app' },
  },
  {
    group: 'action',
    id: 'action-new-schedule',
    title: 'New schedule',
    action: { type: 'overlay', token: 'new-schedule' },
  },
  {
    group: 'action',
    id: 'action-new-note',
    title: 'New note',
    action: { type: 'overlay', token: 'new-note' },
  },
  {
    group: 'action',
    id: 'action-new-folder',
    title: 'New folder',
    action: { type: 'overlay', token: 'new-folder' },
  },
  {
    group: 'action',
    id: 'action-invite-member',
    title: 'Invite member',
    action: { type: 'navigate', href: '/app/settings/members' },
  },
  {
    group: 'action',
    id: 'action-new-workspace',
    title: 'Create workspace',
    action: { type: 'overlay', token: 'new-workspace' },
  },
  {
    group: 'action',
    id: 'action-feedback',
    title: 'Leave feedback',
    action: { type: 'overlay', token: 'feedback' },
  },
];
