import {
  canReadVersion,
  isReleaseNewerThanFork,
  KIT_CHANGELOG,
  KIT_VERSION,
} from '@content/changelog';
import {
  IMPROVEMENTS_HEADING,
  PULL_LATEST_UPDATES_ACTION,
  PULL_THIS_UPDATE_ACTION,
  releaseCopy,
  UNREADABLE_VERSION_STATUS,
  updatesAvailableStatus,
  upToDateStatus,
  YOU_HAVE_THIS_LABEL,
} from './copy';
import { formatMergePrompt, formatMergePromptsInApplyOrder } from './merge-prompt';

function releaseSection(
  release: (typeof KIT_CHANGELOG)[number],
  installedVersion: string,
  versionReadable: boolean,
): string {
  const copy = releaseCopy(release);
  const isNewer = versionReadable && isReleaseNewerThanFork(release, installedVersion);
  return [
    `### ${release.version} · ${copy.title}`,
    `Released ${release.date}${versionReadable && !isNewer ? ` · ${YOU_HAVE_THIS_LABEL}` : ''}`,
    copy.notes.map((note) => `- ${note}`).join('\n'),
    ...(isNewer
      ? [
          `#### Ask your agent to "${PULL_THIS_UPDATE_ACTION}"`,
          formatMergePrompt(release, 'reference'),
        ]
      : []),
  ].join('\n\n');
}

export function changelogMarkdown(installedVersion: string): string {
  const versionReadable = canReadVersion(installedVersion);
  const newerReleases = versionReadable
    ? KIT_CHANGELOG.filter((release) => isReleaseNewerThanFork(release, installedVersion))
    : [];
  const hasNewerVersion = newerReleases.length > 0;
  return [
    '# Updates',
    !versionReadable
      ? UNREADABLE_VERSION_STATUS
      : hasNewerVersion
        ? updatesAvailableStatus(installedVersion, KIT_VERSION)
        : upToDateStatus(installedVersion),
    ...(hasNewerVersion
      ? [
          `### Ask your agent to "${PULL_LATEST_UPDATES_ACTION}"`,
          formatMergePromptsInApplyOrder(newerReleases, 'reference'),
        ]
      : []),
    `## ${IMPROVEMENTS_HEADING}`,
    KIT_CHANGELOG.map((release) => releaseSection(release, installedVersion, versionReadable)).join(
      '\n\n',
    ),
  ].join('\n\n');
}
