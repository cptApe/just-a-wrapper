import { z } from 'zod';
export const sessionListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum([
    'idle',
    'running',
    'rescheduling',
    'requires_input',
    'paused_no_credits',
    'terminated',
  ]),
  favoritedAt: z.coerce.date().nullable(),
  lastEventAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  unread: z.boolean(),
  visibility: z.enum(['private', 'workspace']),
  createdByUserId: z.string(),
  createdBy: z.object({
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  }),
});
