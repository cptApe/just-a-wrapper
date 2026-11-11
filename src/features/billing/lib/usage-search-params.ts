import { parseAsString, parseAsStringLiteral } from 'nuqs/server';

// These filters change server queries, so shallow navigation would leave displayed usage stale.
export const usageParsers = {
  period: parseAsStringLiteral(['cycle', 'last', 'custom'] as const)
    .withDefault('cycle')
    .withOptions({ shallow: false }),
  from: parseAsString.withOptions({ shallow: false }),
  to: parseAsString.withOptions({ shallow: false }),
  member: parseAsString.withOptions({ shallow: false }),
};
