import { type AdminPrompt, formatAdminPrompt } from '@/lib/admin-prompt';
import { brand } from '@/lib/brand/identity';
import { brandRenamePrompt } from './rename-runbook';

export type IdentityField = {
  label: string;
  value: string;
  description: string;
  prompt: AdminPrompt;
};

const commonVerify = ['pnpm validate:config', 'pnpm verify'];

export const BRAND_IDENTITY: readonly IdentityField[] = [
  {
    label: 'Name',
    value: brand.name,
    description:
      'Browser tab, emails, and how your agent introduces itself. Set by NEXT_PUBLIC_BRAND_NAME',
    prompt: brandRenamePrompt(),
  },
  {
    label: 'Web address',
    value: brand.url,
    description: 'The address people visit and links point to. Set by NEXT_PUBLIC_APP_URL',
    prompt: {
      where: "NEXT_PUBLIC_APP_URL in .env and in the hosting provider's environment settings",
      what: `Change the web address from "${brand.url}" to the new address I give you. It is a build-time value, so redeploy after changing it.`,
      guardrails: [
        'Use a full https URL with no trailing slash.',
        'Update the Better Auth, Google sign-in, Stripe and Anthropic webhook URLs that point at the old address (docs/deploy.md lists them).',
        'Do not write the address into the code; it is configuration.',
        'Do not add keys, tokens, passwords, or other secrets anywhere in the repository.',
      ],
      verify: commonVerify,
    },
  },
];

export function identityPromptText(field: IdentityField): string {
  return formatAdminPrompt(field.prompt);
}
