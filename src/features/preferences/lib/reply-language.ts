import { z } from 'zod';

// The languages a member can ask their agent to reply in. The value is the English
// name because the agent reads it in its instructions. Null means match the member.
export const REPLY_LANGUAGES = [
  'Arabic',
  'Chinese (Simplified)',
  'Dutch',
  'English',
  'French',
  'German',
  'Hindi',
  'Indonesian',
  'Italian',
  'Japanese',
  'Korean',
  'Lithuanian',
  'Polish',
  'Portuguese',
  'Russian',
  'Spanish',
  'Swedish',
  'Turkish',
  'Ukrainian',
] as const;

export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export const replyLanguageInputSchema = z.enum(REPLY_LANGUAGES).nullable();

/** A stored value that no longer validates reads as the default. */
export function parseReplyLanguage(value: string | null | undefined): ReplyLanguage | null {
  const parsed = replyLanguageInputSchema.safeParse(value ?? null);
  return parsed.success ? parsed.data : null;
}
