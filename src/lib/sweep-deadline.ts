import { AppError } from './errors';

// Background sweeps stop 60 seconds before the 300-second cron limit, so claims can be released.
const SWEEP_BUDGET_MS = 240_000;

export function sweepDeadline(): number {
  return Date.now() + SWEEP_BUDGET_MS;
}

export class DeadlineReached extends AppError {
  constructor(
    deadline: number,
    message = 'Sweep deadline reached; retained claims resume on the next run',
    context: Record<string, unknown> = {},
  ) {
    super('DEADLINE_REACHED', message, { ...context, deadline });
  }
}

export function assertBeforeDeadline(
  deadline: number,
  message?: string,
  context?: Record<string, unknown>,
): void {
  if (Date.now() >= deadline) throw new DeadlineReached(deadline, message, context);
}
