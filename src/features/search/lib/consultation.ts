// Naming the attached guide skill activates it. Its constants leaf keeps server APIs out of this client module.
import { APP_GUIDE_SKILL_NAME } from '@/features/skills/constants';

export function buildConsultationMessage(query: string): string {
  return (
    `${query}\n\n` +
    `Use the "${APP_GUIDE_SKILL_NAME}" skill for this task. ` +
    'Read the app guide it contains before answering, and answer as a product consultation: ' +
    'explain what the app can do for this question and point to the exact page or action. ' +
    'If the guide does not cover something, say so plainly instead of guessing.'
  );
}
