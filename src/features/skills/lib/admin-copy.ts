import type { PresetSkill } from '../constants';
/** The one deeper read offered by the page. */
export const ANTHROPIC_SKILLS_DOCS_URL =
  'https://platform.claude.com/docs/en/managed-agents/skills';

const CUSTOMER_BENEFITS: Readonly<Record<PresetSkill['directory'], string>> = {
  'app-guide': 'Answers product questions and points customers to the right next step.',
  'create-a-skill': 'Turns a customer’s way of working into instructions the agent can use again.',
};

export function skillCustomerBenefit(directory: PresetSkill['directory']): string {
  return CUSTOMER_BENEFITS[directory];
}
