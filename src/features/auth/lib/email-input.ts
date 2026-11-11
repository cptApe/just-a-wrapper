import { z } from 'zod';

export const emailInput = z.string().trim().toLowerCase().pipe(z.email());
