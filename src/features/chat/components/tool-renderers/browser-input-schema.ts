import { z } from 'zod';
import { lenientOptional } from '../../lib/lenient-optional';
export const browserInputSchema = z.object({
  instruction: lenientOptional(z.string()),
  url: lenientOptional(z.string()),
});
