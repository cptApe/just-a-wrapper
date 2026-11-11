import 'server-only';
import { AppError, type ErrorCode } from './errors';
import { captureException } from './observability';
import { withRequestContext } from './request-context';

// Next masks thrown server-action messages in production; boundaries serialize safe messages.
export type ActionState<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

type ActionBoundary = {
  route: string;
  op?: string;
  feature: string;
  // Sent for any failure that is not an AppError, whose text may hold SQL, identifiers or tokens.
  message: string;
  // Replaces an AppError's own message when a feature has written copy for its codes.
  appErrorMessage?: (error: AppError) => string;
  // An AppError the user can fix, such as a bad confirmation or a signed-out caller, is
  // control flow rather than an incident; return true to leave it out of error tracking.
  expected?: (error: AppError) => boolean;
};

// The one server-action boundary: it opens request context, reports every
// failure and returns it as a value the UI can toast.
export function runAction<T>(
  boundary: ActionBoundary,
  action: () => Promise<T>,
): Promise<ActionState<T>> {
  const { route, op, feature, message, appErrorMessage, expected } = boundary;
  return withRequestContext({ route, op, feature }, async (): Promise<ActionState<T>> => {
    try {
      return { ok: true, data: await action() };
    } catch (error) {
      if (!(error instanceof AppError && expected?.(error))) captureException(error, { route, op });
      if (!(error instanceof AppError)) return { ok: false, code: 'UNEXPECTED', message };
      return {
        ok: false,
        code: error.code,
        message: appErrorMessage ? appErrorMessage(error) : error.message,
      };
    }
  });
}
