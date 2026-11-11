'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { messageFeedback } from '@/db/schema';
import { type ActionState, runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { AppError, type ErrorCode } from '@/lib/errors';
import { MAX_FEEDBACK_LENGTH } from '../types';

// App feedback resolves caller ids server-side and writes the app-kind row; a
// failure returns copy for inline display so the user's text is kept.

const bodySchema = z.string().trim().min(1).max(MAX_FEEDBACK_LENGTH);
const routeSchema = z.string().trim().max(2000);

// A rejected input, a signed-out caller and a missing workspace are states the
// overlay explains, not incidents.
const FEEDBACK_COPY: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: 'Your session has expired. Sign in again to send feedback.',
  WORKSPACE_NOT_FOUND: 'We could not find your workspace. Reload and try again.',
};
const SEND_FAILED_MESSAGE = 'Could not send your feedback. Please try again.';

export async function submitAppFeedback(input: {
  body: string;
  route: string;
}): Promise<ActionState<void>> {
  return runAction(
    {
      route: 'feedback/app',
      feature: 'feedback',
      message: SEND_FAILED_MESSAGE,
      appErrorMessage: (error) =>
        error.code === 'TOOL_INPUT_INVALID'
          ? error.message
          : (FEEDBACK_COPY[error.code] ?? SEND_FAILED_MESSAGE),
      expected: (error) => error.code === 'TOOL_INPUT_INVALID' || error.code in FEEDBACK_COPY,
    },
    async () => {
      const body = bodySchema.safeParse(input.body);
      if (!body.success) {
        throw new AppError(
          'TOOL_INPUT_INVALID',
          `Feedback must be between 1 and ${MAX_FEEDBACK_LENGTH} characters.`,
          {},
        );
      }
      const route = routeSchema.safeParse(input.route);
      if (!route.success) {
        throw new AppError(
          'TOOL_INPUT_INVALID',
          'The page address is invalid. Reload and try again.',
          {},
        );
      }
      const { userId, workspaceId } = await resolveCaller(await headers());

      await db.insert(messageFeedback).values({
        kind: 'app',
        workspaceId,
        userId,
        body: body.data,
        route: route.data,
      });
    },
  );
}
