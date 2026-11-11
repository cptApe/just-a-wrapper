import { z } from 'zod';

export const organizationIdSchema = z.string().min(1).brand<'OrganizationId'>();
export type OrganizationId = z.infer<typeof organizationIdSchema>;

export type WorkspaceId = string & z.$brand<'WorkspaceId'>;

// Internal callers already hold authorized IDs; parse only at external boundaries.
export function organizationId(value: string): OrganizationId {
  return value as OrganizationId;
}
export function workspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}
