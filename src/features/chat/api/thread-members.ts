import { listWorkspaceMembers } from '@/features/workspaces/api/members';
import type { ThreadMember } from '../types';
import 'server-only';

/** The member directory behind the author chips on a shared thread. */
export async function loadThreadMembers(organizationId: string): Promise<ThreadMember[]> {
  const members = await listWorkspaceMembers(organizationId);
  return members.map((member) => ({
    userId: member.userId,
    name: member.name.trim() || member.email.split('@')[0] || 'Teammate',
    image: member.image,
  }));
}
