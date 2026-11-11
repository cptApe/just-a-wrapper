'use client';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

import { formatCount } from '@/lib/format/format-number';
import { initialsFrom } from '@/lib/initials';
import { cn } from '@/lib/utils';
import {
  MEMBER_AVATAR,
  MEMBER_BADGE_COL,
  MEMBER_CREDITS_COL,
  MEMBER_IDENTITY,
  MEMBER_LAST_ACTIVE_COL,
  MEMBER_ROW,
  MEMBER_TRAILING,
} from '../lib/members-row-geometry';
import { ROLE_LABEL, type WorkspaceRole } from '../lib/roles';
import { MemberActionsMenu } from './member-actions-menu';
import type { MemberListItem } from './members-table';

const ROLE_BADGE_VARIANT: Record<WorkspaceRole, 'default' | 'muted' | 'outline'> = {
  owner: 'default',
  admin: 'muted',
  member: 'outline',
};

export function MemberTableRow({
  member,
  viewerRole,
  ownerCount,
  busy,
  isAdmin,
  changeRole,
  setConfirmRemove,
}: {
  member: MemberListItem;
  viewerRole: WorkspaceRole;
  ownerCount: number;
  busy: boolean;
  isAdmin: boolean;
  changeRole: (member: MemberListItem, role: WorkspaceRole) => void;
  setConfirmRemove: (member: MemberListItem) => void;
}) {
  return (
    <li className={MEMBER_ROW}>
      <Avatar className={MEMBER_AVATAR}>
        {member.image ? <AvatarImage src={member.image} alt="" /> : null}
        <AvatarFallback className="text-meta">
          {initialsFrom(member.name, member.email)}
        </AvatarFallback>
      </Avatar>

      <div className={MEMBER_IDENTITY}>
        <p className="truncate text-body font-medium">{member.name || member.email}</p>
        <p className="truncate text-meta text-muted-foreground">{member.email}</p>
      </div>

      <Badge
        variant={ROLE_BADGE_VARIANT[member.role]}
        shape="pill"
        className={cn(MEMBER_BADGE_COL, 'capitalize')}
      >
        {ROLE_LABEL[member.role]}
      </Badge>

      <span className={cn(MEMBER_LAST_ACTIVE_COL, 'items-center text-meta text-muted-foreground')}>
        {member.lastActiveLabel}
      </span>

      {member.creditsUsed === null ? (
        <span className={MEMBER_CREDITS_COL} />
      ) : !isAdmin ? (
        // Usage pages open other members' usage only for admins, so a member sees the number alone.
        <span className={cn(MEMBER_CREDITS_COL, 'text-meta tabular-nums text-muted-foreground')}>
          {formatCount(member.creditsUsed)}
        </span>
      ) : (
        <Link
          href={`/app/settings/usage?member=${member.userId}`}
          className={cn(
            MEMBER_CREDITS_COL,
            'text-meta tabular-nums text-muted-foreground hover:text-foreground',
          )}
          title="View this member’s usage"
          aria-label={`View usage for ${member.name || member.email}: ${formatCount(member.creditsUsed)} credits`}
        >
          {formatCount(member.creditsUsed)}
        </Link>
      )}

      {isAdmin ? (
        <MemberActionsMenu
          member={member}
          viewerRole={viewerRole}
          ownerCount={ownerCount}
          busy={busy}
          changeRole={changeRole}
          setConfirmRemove={setConfirmRemove}
        />
      ) : (
        // A non-admin row has no actions menu, but it still reserves the
        // trailing slot so its badge / last-active / credits sit exactly
        // where an admin's (and the skeleton's) do — the row geometry is
        // role-invariant and nothing shifts when the role resolves.
        <div className={MEMBER_TRAILING} aria-hidden />
      )}
    </li>
  );
}
