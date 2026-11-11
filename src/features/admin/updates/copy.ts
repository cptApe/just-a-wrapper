import type { KitRelease } from '@content/changelog';

export const IMPROVEMENTS_HEADING = 'Changelog';
export const PULL_LATEST_UPDATES_ACTION = 'pull the latest updates';
export const PULL_THIS_UPDATE_ACTION = 'pull this update';
export const YOU_HAVE_THIS_LABEL = 'You have this';
export const UNREADABLE_VERSION_STATUS = 'We could not read your version.';

export function upToDateStatus(installedVersion: string): string {
  return `You're up to date · Version ${installedVersion}`;
}

export function updatesAvailableStatus(installedVersion: string, newestVersion: string): string {
  return `Updates available. You started from ${installedVersion}. The kit is now at ${newestVersion}.`;
}

type ReleaseCopy = Pick<KitRelease, 'title' | 'notes'>;

// Changelog notes are the technical record; these are the short plain versions.
const RELEASE_COPY: Readonly<Partial<Record<string, ReleaseCopy>>> = {
  '0.6.0': {
    title: 'A polished console and a smoother chat',
    notes: [
      'Every admin page now works the same way, with short buttons that copy instructions for your coding agent.',
      'Theme editing uses named colors, corner sizes, and real fonts, and keeps your text readable.',
      'Chat loads faster, attaches files and skills anywhere, and shows which plan each task runs on.',
    ],
  },
  '0.5.0': {
    title: 'A simpler way to set up your kit',
    notes: [
      'A new setup area shows what your kit is using and where to change it.',
      'The most capable option now uses the newest model, and its helper text is clearer.',
      'Pricing, approvals, and progress messages now work more clearly.',
    ],
  },
  '0.4.0': {
    title: 'A kit you can make your own',
    notes: [
      'Your product name, web address, and support email now live in one place.',
      'Plans, credits, daily free use, team limits, and top-ups now share one pricing setup.',
      'Your agent can now help you change the name, look, pricing, and included skills.',
    ],
  },
  '0.3.0': {
    title: 'Better teamwork and less waiting',
    notes: [
      'Tasks stay private until you choose to share them with your team.',
      'Moving between lists is faster because the app keeps what it has already loaded.',
      'The app now works better on phones, and broken pages explain what went wrong.',
    ],
  },
  '0.2.0': {
    title: 'A clearer, more consistent app',
    notes: [
      'Links can reopen the exact page, panel, or window you were viewing.',
      'Files, actions, and scheduled tasks now share the same way of browsing and finding things.',
      'Search, settings, loading screens, and agent results are easier to use.',
    ],
  },
  '0.1.0': {
    title: 'The complete starting point',
    notes: [
      'People can sign in by email or Google, and each account gets its own space.',
      'Chat replies arrive as they are written, and files, memory, and skills each have a clear home.',
      'Scheduled tasks, connected apps, payments, and notifications are ready to set up.',
    ],
  },
};

const MAX_NOTES = 3;

export function releaseCopy(release: KitRelease): ReleaseCopy {
  const copy = RELEASE_COPY[release.version];
  if (copy) return copy;

  return {
    title: release.title.replaceAll(/fork/gi, 'kit'),
    notes: release.notes.slice(0, MAX_NOTES),
  };
}
