import { z } from 'zod';

// Malformed optional tool metadata must not hide an otherwise readable result.
export function lenientOptional<T extends z.ZodType>(schema: T) {
  return z.union([schema, z.undefined()]).catch(undefined);
}
