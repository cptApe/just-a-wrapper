import 'server-only';
import { readDeploymentSetting } from '../deployment-settings/store';

// Contact details an operator may change while the app runs: the admin console's value, then the
// env value, then a placeholder. Server code reads them here; client components get them from
// ContactDetailsProvider, which a layout fills from this function.

export type ContactDetails = {
  /** The Get help link, the footer of every email and the contact line of the legal pages. */
  supportEmail: string;
};

export async function readContactDetails(): Promise<ContactDetails> {
  const supportEmail = await readDeploymentSetting('supportEmail');
  return { supportEmail: supportEmail.value };
}
