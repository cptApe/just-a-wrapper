import type { ThemeTokenGroup } from './types';

/** The file every token is parsed from and every prompt points at. */
export const THEME_SOURCE_PATH = 'src/app/globals.css';

/** Group order everywhere a token list is rendered or emitted. */
export const THEME_TOKEN_GROUPS: readonly ThemeTokenGroup[] = ['Colors', 'Radius', 'Type'];

export const NAMED_THEME_COLORS = [
  {
    label: 'Page',
    hint: 'The page behind everything',
    token: '--background',
    companions: [
      '--alpha-3',
      '--alpha-6',
      '--alpha-8',
      '--alpha-12',
      '--alpha-16',
      '--alpha-24',
      '--border',
      '--input',
      '--ring',
      '--muted',
      '--secondary',
      '--accent',
    ],
  },
  {
    label: 'Sidebar',
    hint: 'The navigation column',
    token: '--sidebar',
    companions: ['--sidebar-accent', '--sidebar-border'],
  },
  { label: 'Card', hint: 'The chat input and raised blocks', token: '--card', companions: [] },
  { label: 'Dialog', hint: 'Dialogs, sheets, and popovers', token: '--popover', companions: [] },
  {
    label: 'Menu',
    hint: 'Dropdown menus',
    token: '--glass-bg',
    companions: [
      '--glass-fg',
      '--glass-fg-secondary',
      '--glass-fg-tertiary',
      '--glass-bg-hover',
      '--glass-separator',
    ],
  },
  {
    label: 'Text',
    hint: 'Body text and icons',
    token: '--foreground',
    companions: [
      '--card-foreground',
      '--popover-foreground',
      '--sidebar-foreground',
      '--sidebar-accent-foreground',
      '--secondary-foreground',
    ],
  },
  {
    label: 'Secondary text',
    hint: 'Descriptions and metadata',
    token: '--muted-foreground',
    companions: [],
  },
  {
    label: 'Tertiary text',
    hint: 'Placeholders and inactive tabs',
    token: '--foreground-tertiary',
    companions: [],
  },
  {
    label: 'Primary',
    hint: 'Buttons and selected states',
    token: '--primary',
    companions: ['--primary-foreground'],
  },
  {
    label: 'Attention',
    hint: 'Links and unread markers',
    token: '--attention',
    companions: [],
  },
  {
    label: 'Success',
    hint: 'Confirmations and connected states',
    token: '--success',
    companions: ['--success-hsl', '--success-soft', '--success-strong'],
  },
  {
    label: 'Warning',
    hint: 'Caution notices',
    token: '--warning',
    companions: ['--warning-hsl', '--warning-soft', '--warning-strong'],
  },
  {
    label: 'Error',
    hint: 'Errors and destructive actions',
    token: '--destructive',
    companions: ['--destructive-hsl', '--destructive-soft', '--destructive-strong'],
  },
] as const;

export type NamedThemeColor = (typeof NAMED_THEME_COLORS)[number];

/** How the editor groups the named colours. Order here is the order on screen. */
export const THEME_COLOR_GROUPS: readonly {
  title: string;
  hint?: string;
  tokens: readonly NamedThemeColor['token'][];
}[] = [
  { title: 'Surfaces', tokens: ['--background', '--sidebar', '--card', '--popover', '--glass-bg'] },
  { title: 'Text', tokens: ['--foreground', '--muted-foreground', '--foreground-tertiary'] },
  { title: 'Brand', tokens: ['--primary', '--attention'] },
  { title: 'Status', tokens: ['--success', '--warning', '--destructive'] },
];

/** The deployment's corner radius; the four named sizes derive from it. */
export const RADIUS_BASE_TOKEN = '--radius-base';
/** Buttons and pill controls: a px value, or PILL_RADIUS for fully round ends. */
export const BUTTON_RADIUS_TOKEN = '--radius-button';
const PILL_RADIUS = '9999px';

/** Corner radius choices, shown with their pixel value so the label is accurate. */
export const CORNER_RADIUS_CHOICES = [
  { label: 'None', value: '0px' },
  { label: 'Small', value: '6px' },
  { label: 'Medium', value: '10px' },
  { label: 'Large', value: '14px' },
] as const;

/** Button radius choices: the same steps as corners, then a pill. */
export const BUTTON_RADIUS_CHOICES = [
  { label: 'None', value: '0px' },
  { label: 'Small', value: '6px' },
  { label: 'Medium', value: '10px' },
  { label: 'Large', value: '14px' },
  { label: 'Pill', value: PILL_RADIUS },
] as const;
