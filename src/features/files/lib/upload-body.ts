import { z } from 'zod';

// Metadata belongs to the browser completion flow, so callbacks are not accepted.
export const uploadBody = z.object({
  type: z.literal('blob.generate-client-token'),
  payload: z.object({
    pathname: z.string().min(1),
    clientPayload: z.string().nullable(),
    multipart: z.boolean(),
  }),
});
