import { AppError } from './errors';

export function assertExpectedOrganization(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new AppError('WORKSPACE_CHANGED', 'Your workspace changed. Reload before trying again.', {
      expectedState: true,
      expectedOrganizationId: expected,
      organizationId: actual,
    });
  }
}
