import { IconPlus, IconSearchMd } from '@/components/icons';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { SettingsSection } from '@/components/settings/settings-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MEMBER_AVATAR,
  MEMBER_BADGE_COL,
  MEMBER_CREDITS_COL,
  MEMBER_IDENTITY,
  MEMBER_LAST_ACTIVE_COL,
  MEMBER_ROW,
  MEMBER_TRAILING,
} from '@/features/workspaces/lib/members-row-geometry';

// Mirrors the Members page for the common case, a solo owner: the Add members
// action, the search box, one member row, and the Pending invitations section
// with its empty line. Static chrome renders as real text; only member data
// pulses.
export function MembersPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading members">
      <SettingsPageHeader
        title="Members"
        action={
          <Button size="sm" disabled tabIndex={-1}>
            <IconPlus className="size-4" aria-hidden />
            Add members
          </Button>
        }
      />
      <div className="pt-8">
        <div className="flex flex-col gap-4">
          <div className="relative max-w-sm">
            <IconSearchMd
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              disabled
              tabIndex={-1}
              placeholder="Search by name or email"
              aria-hidden
              className="pl-9"
            />
          </div>
          <ul className="flex flex-col">
            <li className={MEMBER_ROW}>
              <Skeleton className={`${MEMBER_AVATAR} rounded-full`} />
              <div className={`${MEMBER_IDENTITY} flex flex-col`}>
                <div className="flex h-[22px] items-center">
                  <Skeleton className="h-3.5 w-32 rounded-sm" />
                </div>
                <div className="flex h-[18px] items-center">
                  <Skeleton className="h-3 w-44 rounded-sm" />
                </div>
              </div>
              <Badge
                aria-hidden
                variant="muted"
                shape="pill"
                className={`${MEMBER_BADGE_COL} animate-pulse text-transparent`}
              >
                Owner
              </Badge>
              <span className={`${MEMBER_LAST_ACTIVE_COL} h-[18px] items-center`}>
                <Skeleton className="h-3 w-16 rounded-sm" />
              </span>
              <span className={`${MEMBER_CREDITS_COL} h-[18px] items-center`}>
                <Skeleton className="h-3 w-10 rounded-sm" />
              </span>
              <span className={MEMBER_TRAILING} />
            </li>
          </ul>
        </div>

        <SettingsSection
          title="Pending invitations"
          divided={false}
          hint={
            <InfoHint>
              Invitations stay here until they’re accepted. Expired ones can be resent.
            </InfoHint>
          }
        >
          <p className="py-4 text-meta text-muted-foreground">
            No pending invitations. Invite someone above and they’ll show up here until they accept.
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}
