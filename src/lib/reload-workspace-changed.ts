import { AppError } from './errors';

export function reloadWorkspaceChanged(failure: { error: unknown } | { code: string }): boolean {
  const code =
    'code' in failure
      ? failure.code
      : failure.error instanceof AppError
        ? failure.error.context.serverCode
        : undefined;
  if (code !== 'WORKSPACE_CHANGED') return false;
  window.location.reload();
  return true;
}
