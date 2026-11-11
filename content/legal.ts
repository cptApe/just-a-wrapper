// The terms and privacy policy. The words describe the operator of wrapper.arnas.st, one person
// running a small open-source project; a fork rewrites them for whoever runs it. The product name
// and contact address come in as values, so a deployment sets them in configuration.

/** The values a legal page names: the product name and the address people write to. */
export type LegalParties = { name: string; supportEmail: string };

export type LegalDocument = {
  title: string;
  updatedAt: string;
  updatedLabel: string;
  sections: readonly { heading: string; paragraphs: readonly string[] }[];
};

const updated = { updatedAt: '2026-11-09', updatedLabel: '9 November 2026' };

export const TERMS_TITLE = 'Terms of service';
export const PRIVACY_TITLE = 'Privacy policy';

export function termsDocument({ name, supportEmail }: LegalParties): LegalDocument {
  return {
    title: TERMS_TITLE,
    ...updated,
    sections: [
      {
        heading: 'The short version',
        paragraphs: [
          `${name} is a small open-source project. It is offered as is, with no promises that it will work for you.`,
          `Used credits are not refundable. Email ${supportEmail} with any questions.`,
        ],
      },
    ],
  };
}

export function privacyDocument({ name, supportEmail }: LegalParties): LegalDocument {
  return {
    title: PRIVACY_TITLE,
    ...updated,
    sections: [
      {
        heading: 'Who this policy is for',
        paragraphs: [
          `${name} is run by one person, not a company. In this policy, "we" and "us" mean that person, who decides how your information is used. This policy explains how ${name} handles personal information when you visit the site or use the service. Contact ${supportEmail} about your information.`,
        ],
      },
      {
        heading: 'What we collect',
        paragraphs: [
          'Account information includes your name, email address, sign-in details and workspace membership. Workspace content includes messages, files, task results, saved memory and information from apps you connect. The agent accesses connected information within the permissions you grant.',
          'We collect service usage and error events, including page visits and task activity, through PostHog. Technical information can include browser, device and connection details. Stripe handles payment details; we keep billing records such as your plan, payment status and transaction references.',
        ],
      },
      {
        heading: 'Why we use it',
        paragraphs: [
          'We use information to provide your account, run tasks, save your work, process payments and send service messages. We also use it to answer support requests, investigate errors, prevent abuse and understand which parts of the product work well.',
          'Where data protection law requires a legal basis, we rely on providing the service you request, our legitimate interests in running and securing it, and legal duties such as keeping billing records. Where we rely on consent, you can withdraw it by contacting us.',
        ],
      },
      {
        heading: 'Service providers and connected apps',
        paragraphs: [
          'Our processors include Vercel for hosting, Neon for the database, Anthropic for AI processing, Stripe for payments, Resend for email, PostHog for usage analytics and error reporting. They receive the information needed for their part of the service.',
          'Tasks can send relevant content to AI providers and to apps you connect. Information you share with a connected app is also subject to that app’s privacy policy. Providers may process information in countries other than yours. Contact us for details about the providers and safeguards that apply to your information.',
        ],
      },
      {
        heading: 'How long we keep information',
        paragraphs: [
          'We keep account and workspace information while it is needed to provide the service. You can delete your account in Settings or contact us to request deletion. Content shared with a workspace may remain available to its other members.',
          'Some information may remain in backups or be kept to meet legal duties, resolve disputes, prevent abuse or maintain billing records. Retention depends on the type of information and why it is needed; contact us for details about a specific record.',
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'Depending on where you live, you may have rights to access, correct, delete or receive a copy of your personal information, and to object to or limit certain uses. You can request access by email and request deletion through Settings or by email. We may need to check your identity before acting.',
          'If you are the only owner of a workspace with other members, transfer ownership or remove the members before deleting your account. Account deletion does not delete your accounts at connected services.',
          'You can withdraw consent where processing depends on it. You can also complain to your local data protection authority. Withdrawing consent does not change whether earlier processing was lawful.',
        ],
      },
      {
        heading: 'Cookies and browser storage',
        paragraphs: [
          'We use cookies and browser storage to keep you signed in and remember preferences. PostHog may also use browser storage to connect usage events. You can manage cookies and site storage through your browser; blocking essential cookies can prevent sign-in or other features from working.',
        ],
      },
      {
        heading: 'Changes to this policy',
        paragraphs: [
          'We update this page when our practices change and change the date at the top. We will give notice of material changes where required.',
        ],
      },
      { heading: 'Contact', paragraphs: [`Email ${supportEmail} with questions or requests.`] },
    ],
  };
}
