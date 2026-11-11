import 'server-only';
import { brand } from '@/lib/brand/identity';
import { DEPLOYMENT_SETTINGS } from '@/lib/deployment-settings/registry';
import { readDeploymentSetting } from '@/lib/deployment-settings/store';
import { BRAND_IDENTITY, identityPromptText } from './identity';
import { OPEN_GRAPH_IMAGE } from './open-graph';
import { resolvedOrigin } from './origin';
import { HOME_PAGE_METADATA } from './page-metadata';

function identitySection(): string {
  return BRAND_IDENTITY.map((field) =>
    [
      `### ${field.label}`,
      field.value,
      '<details>',
      '<summary>Where this shows up</summary>',
      '',
      field.description,
      '',
      '</details>',
      '<details>',
      '<summary>Change</summary>',
      '',
      identityPromptText(field),
      '',
      '</details>',
    ].join('\n\n'),
  ).join('\n\n');
}

async function contactSection(): Promise<string> {
  const definition = DEPLOYMENT_SETTINGS.supportEmail;
  const setting = await readDeploymentSetting('supportEmail');
  const from =
    setting.source === 'stored'
      ? 'Set in the admin console'
      : setting.source === 'env'
        ? `From ${definition.envKey}`
        : `A placeholder, because ${definition.envKey} is not set`;
  return [`### ${definition.label}`, setting.value, `${from}. ${definition.description}`].join(
    '\n\n',
  );
}

export async function buildBrandMarkdown(): Promise<string> {
  const origin = resolvedOrigin();
  const imageUrl = `${origin.url}${OPEN_GRAPH_IMAGE.path}`;

  return [
    '# Brand',
    '## Who your app is',
    identitySection(),
    '## Contact',
    await contactSection(),
    '## Link previews',
    `### On Google\n\n${brand.name}\n\n${origin.host}\n\n${HOME_PAGE_METADATA.title}\n\n${HOME_PAGE_METADATA.description}`,
    `### In messages and social apps\n\n![${brand.name}](${imageUrl})\n\n${origin.host}\n\n${HOME_PAGE_METADATA.title}\n\n${HOME_PAGE_METADATA.description}`,
  ].join('\n\n');
}
