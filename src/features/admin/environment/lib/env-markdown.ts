import { adminPageMeta } from '../../registry';
import { readEnvironmentKeys } from './env-status';
import { type CapabilityKey, readCapabilityGroups } from './environment-capabilities';

function cell(text: string): string {
  return text.replaceAll('|', '\\|');
}

function row(key: CapabilityKey): string {
  const status = key.isSet ? 'Set' : `Not set. ${key.unset}.`;
  return `| ${cell(key.description)} | ${cell(status)} | \`${cell(key.name)}\` |`;
}

export function environmentMarkdown(): string {
  const meta = adminPageMeta('environment');
  const groups = readCapabilityGroups(readEnvironmentKeys());
  const missingRequired = groups
    .flatMap((section) => section.keys)
    .filter((key) => key.required && !key.isSet);

  const parts = [`# ${meta.title}`, 'Values never appear on the page or in this Markdown copy.'];

  if (missingRequired.length > 0) {
    parts.push(
      "## Your app can't start without these",
      missingRequired
        .map((key) => `- **${cell(key.description)}:** \`${cell(key.name)}\``)
        .join('\n'),
    );
  }

  for (const section of groups) {
    parts.push(
      `## ${section.group}`,
      ['| What it unlocks | Status | Key |', '| --- | --- | --- |']
        .concat(section.keys.map(row))
        .join('\n'),
    );
  }

  return parts.join('\n\n');
}
