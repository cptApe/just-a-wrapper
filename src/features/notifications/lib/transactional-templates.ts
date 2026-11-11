import type { ContactDetails } from '@/lib/brand/contact';
import { brand } from '@/lib/brand/identity';
import { emailLayout } from './email-layout';

export type TransactionalEmail = {
  subject: string;
  text: string;
  html: string;
  parts: {
    heading: string;
    lines: string[];
    highlight?: string;
    link?: { url: string; label: string };
    footerReason: string;
  };
};

function transactionalEmail(
  subject: string,
  parts: TransactionalEmail['parts'],
  contact: ContactDetails,
): TransactionalEmail {
  return {
    subject,
    ...emailLayout({ ...parts, button: parts.link, supportEmail: contact.supportEmail }),
    parts,
  };
}

export function signInCodeEmail(input: {
  code: string;
  expiresMinutes: number;
  contact: ContactDetails;
}): TransactionalEmail {
  const code = input.code.trim();
  return transactionalEmail(
    `${code} is your ${brand.name} sign-in code`,
    {
      heading: 'Your sign-in code',
      highlight: code,
      lines: [`It works for ${input.expiresMinutes} minutes.`],
      footerReason: 'You asked to sign in. If this was not you, ignore this email.',
    },
    input.contact,
  );
}

export function verifyEmailChangeEmail(input: {
  url: string;
  expiresMinutes: number;
  contact: ContactDetails;
}): TransactionalEmail {
  return transactionalEmail(
    `Confirm your new email for ${brand.name}`,
    {
      heading: 'Confirm your new email',
      lines: [
        `Confirm this address to use it for ${brand.name}.`,
        `The link works for ${input.expiresMinutes} minutes.`,
      ],
      link: { url: input.url, label: 'Confirm new email' },
      footerReason: 'You asked to change your email. If this was not you, ignore this message.',
    },
    input.contact,
  );
}

export function invitationEmail(input: {
  inviteLink: string;
  inviterName: string;
  inviterEmail: string;
  organizationName: string;
  expiresDays: number;
  contact: ContactDetails;
}): TransactionalEmail {
  const inviter = input.inviterName.trim() || input.inviterEmail;
  return transactionalEmail(
    `${inviter} invited you to ${input.organizationName} on ${brand.name}`,
    {
      heading: `${inviter} invited you to ${input.organizationName}`,
      lines: [
        `Join their workspace on ${brand.name}.`,
        `The invitation works for ${input.expiresDays} days.`,
      ],
      link: { url: input.inviteLink, label: `Join ${input.organizationName}` },
      footerReason: `${input.inviterEmail} sent you this invitation.`,
    },
    input.contact,
  );
}
