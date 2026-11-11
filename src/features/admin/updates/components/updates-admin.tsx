import {
  canReadVersion,
  isReleaseNewerThanFork,
  KIT_CHANGELOG,
  KIT_VERSION,
} from '@content/changelog';
import { AdminSection } from '@/components/admin/admin-section';
import { AdminAgentButton } from '@/components/admin/agent-button';
import { AdminStatusBanner } from '@/components/admin/status-banner';
import {
  IMPROVEMENTS_HEADING,
  PULL_LATEST_UPDATES_ACTION,
  UNREADABLE_VERSION_STATUS,
  updatesAvailableStatus,
  upToDateStatus,
} from '../copy';
import { formatMergePromptsInApplyOrder } from '../merge-prompt';
import { ReleaseEntry } from './release-entry';

export function UpdatesAdmin({ installedVersion }: { installedVersion: string }) {
  const versionReadable = canReadVersion(installedVersion);
  const newerReleases = versionReadable
    ? KIT_CHANGELOG.filter((release) => isReleaseNewerThanFork(release, installedVersion))
    : [];
  const hasNewerVersion = newerReleases.length > 0;

  return (
    <>
      {versionReadable ? (
        <AdminStatusBanner
          tone={hasNewerVersion ? 'attention' : 'ready'}
          action={
            hasNewerVersion ? (
              <AdminAgentButton
                action={PULL_LATEST_UPDATES_ACTION}
                op="admin.copy-update-prompt"
                text={formatMergePromptsInApplyOrder(newerReleases)}
              />
            ) : undefined
          }
        >
          {hasNewerVersion
            ? updatesAvailableStatus(installedVersion, KIT_VERSION)
            : upToDateStatus(installedVersion)}
        </AdminStatusBanner>
      ) : (
        <p role="status" className="text-title-card text-foreground">
          {UNREADABLE_VERSION_STATUS}
        </p>
      )}

      <AdminSection title={IMPROVEMENTS_HEADING}>
        <div className="flex flex-col gap-5">
          {KIT_CHANGELOG.map((release) => (
            <ReleaseEntry
              key={release.version}
              release={release}
              status={
                !versionReadable
                  ? 'unknown'
                  : isReleaseNewerThanFork(release, installedVersion)
                    ? 'newer'
                    : 'included'
              }
            />
          ))}
        </div>
      </AdminSection>
    </>
  );
}
