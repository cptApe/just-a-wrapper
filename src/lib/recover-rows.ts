import { AppError } from './errors';

// Durable failures keep navigation cooldowns; failed discovery queries remain immediately retryable.
export class DurableRecoveryError extends AppError {
  constructor(failures: unknown[]) {
    super(
      'EXTERNAL_API_FAILED',
      'Recovery has unfinished durable operations',
      { failures: failures.length },
      { cause: new AggregateError(failures) },
    );
  }
}

type RecoveryLimits = { deadline: number; concurrency?: number };

// Rows left when the deadline passes stay claimable for the next sweep.
export async function collectRecoveryFailures<Row>(
  rows: Row[],
  recover: (row: Row) => Promise<void>,
  { deadline, concurrency = 10 }: RecoveryLimits,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (let offset = 0; offset < rows.length && Date.now() < deadline; offset += concurrency) {
    const outcomes = await Promise.allSettled(
      rows.slice(offset, offset + concurrency).map(recover),
    );
    for (const outcome of outcomes)
      if (outcome.status === 'rejected') failures.push(outcome.reason);
  }
  return failures;
}

export async function recoverRows<Row>(
  rows: Row[],
  recover: (row: Row) => Promise<void>,
  limits: RecoveryLimits,
): Promise<void> {
  const failures = await collectRecoveryFailures(rows, recover, limits);
  if (failures.length > 0) throw new DurableRecoveryError(failures);
}

export async function settleRecoveryOperations(
  operations: Promise<void>[],
): Promise<{ completed: number }> {
  const outcomes = await Promise.allSettled(operations);
  const failures = outcomes
    .filter((outcome) => outcome.status === 'rejected')
    .map((outcome) => outcome.reason);
  if (failures.length > 0) {
    if (failures.every((failure) => failure instanceof DurableRecoveryError))
      throw new DurableRecoveryError(failures);
    throw new AppError(
      'EXTERNAL_API_FAILED',
      'Recovery sweeps failed',
      {},
      { cause: new AggregateError(failures) },
    );
  }
  return { completed: outcomes.length };
}
