import type { SessionWriteGrant } from '@/features/sessions/api/session-access';

type GrantFields = Pick<
  SessionWriteGrant,
  'workspaceId' | 'organizationId' | 'userId' | 'sessionRowId' | 'anthropicSessionId'
> &
  Partial<Omit<SessionWriteGrant, 'workspaceId' | 'organizationId' | 'userId'>>;

// Feature tests below the route boundary stand in for authorizeSessionWrite, whose own
// behaviour tests/integration/session-access.test.ts covers against real rows.
export function writeGrantForTest(fields: GrantFields): SessionWriteGrant {
  return {
    email: `${fields.userId}@example.test`,
    name: 'Test',
    workspaceName: 'Workspace',
    role: 'owner',
    createdByUserId: fields.userId,
    permissionMode: 'ask',
    visibility: 'private',
    lastEventAt: null,
    ...fields,
  } as SessionWriteGrant;
}
