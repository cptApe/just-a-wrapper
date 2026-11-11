import type { EnvKeyStatus } from './env-status';
import { type CapabilityKey, readCapabilityGroups } from './environment-capabilities';

// Every value is left blank and commented out, so pasting this over a real .env
// never changes behaviour.

const RULE = `# ${'-'.repeat(74)}`;

const PREAMBLE = [
  '# Key template',
  '#',
  '# Every key this app reads, with all values safely commented out.',
  '# Remove # and fill in the keys for the parts you want, then restart.',
  '# Lines marked NOT SET are missing from the server that made this template.',
  '#',
  '# Never commit this file once it has values in it.',
];

function heading(title: string, note?: string): string[] {
  return [RULE, `# ${title}`, ...(note ? [`# ${note}`] : []), RULE];
}

function entry(key: CapabilityKey): string[] {
  return [
    `# ${key.description}`,
    ...(!key.isSet ? [`# NOT SET: ${key.unset}.`] : []),
    `# ${key.name}=`,
  ];
}

export function buildEnvTemplate(keys: readonly EnvKeyStatus[]): string {
  const groups = readCapabilityGroups(keys);
  const missingRequired = groups
    .flatMap((section) => section.keys)
    .filter((key) => key.required && !key.isSet);
  const missing = new Set(missingRequired.map((key) => key.name));
  const sections: string[][] = [];

  if (missingRequired.length > 0) {
    sections.push([
      ...heading("Your app can't start without these", 'Fill these in first.'),
      '',
      ...missingRequired.flatMap((key) => [...entry(key), '']),
    ]);
  }

  for (const section of groups) {
    // A missing required key is already written out above.
    const remaining = section.keys.filter((key) => !missing.has(key.name));
    if (remaining.length === 0) continue;
    sections.push([
      ...heading(section.group),
      '',
      ...remaining.flatMap((key) => [...entry(key), '']),
    ]);
  }

  return [...PREAMBLE, '', ...sections.flatMap((section) => [...section])].join('\n').trimEnd();
}
