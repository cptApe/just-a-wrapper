import { AppError } from './errors';

/** User-correctable states that should render plainly without error reporting. */
export function isExpectedUserStateError(error: unknown): error is AppError {
  return error instanceof AppError && error.context.expectedState === true;
}
