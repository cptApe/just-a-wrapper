'use client';

import { IconDotsHorizontal } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MEMBER_TRAILING } from '../lib/members-row-geometry';
import {
  ROLE_LABEL,
  removalBlockedReason,
  roleChangeBlockedReason,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '../lib/roles';
import type { MemberListItem } from './members-table';

// A disabled menu item has no pointer events, so a focusable span carries the tip.
function BlockedReasonTip({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function MemberActionsMenu({
  member,
  viewerRole,
  ownerCount,
  busy,
  changeRole,
  setConfirmRemove,
}: {
  member: MemberListItem;
  viewerRole: WorkspaceRole;
  ownerCount: number;
  busy: boolean;
  changeRole: (member: MemberListItem, role: WorkspaceRole) => void;
  setConfirmRemove: (member: MemberListItem) => void;
}) {
  const removeBlockedReason = removalBlockedReason(viewerRole, member, ownerCount);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${member.name || member.email}`}
        disabled={busy}
        className={cn(
          MEMBER_TRAILING,
          'flex items-center justify-center rounded-button text-muted-foreground hover:bg-alpha-8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-alpha-8',
        )}
        data-testid={`member-actions-${member.email}`}
      >
        {busy ? <Spinner aria-hidden /> : <IconDotsHorizontal className="size-4" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Role</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={member.role}
          onValueChange={(value) => {
            const role = WORKSPACE_ROLES.find((role) => role === value);
            if (role) changeRole(member, role);
          }}
        >
          {WORKSPACE_ROLES.map((role) => {
            const blockedReason = roleChangeBlockedReason(
              viewerRole,
              member.role,
              role,
              ownerCount,
            );
            const item = (
              <DropdownMenuRadioItem
                key={role}
                value={role}
                disabled={blockedReason !== null}
                data-testid={`set-role-${role}-${member.email}`}
              >
                {ROLE_LABEL[role]}
              </DropdownMenuRadioItem>
            );
            return blockedReason ? (
              <BlockedReasonTip key={role} reason={blockedReason}>
                {item}
              </BlockedReasonTip>
            ) : (
              item
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {removeBlockedReason ? (
          <BlockedReasonTip reason={removeBlockedReason}>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled
              data-testid={`remove-member-${member.email}`}
            >
              Remove from workspace
            </DropdownMenuItem>
          </BlockedReasonTip>
        ) : (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setConfirmRemove(member)}
            data-testid={`remove-member-${member.email}`}
          >
            Remove from workspace
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
