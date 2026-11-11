import { ENV_REGISTRY } from '../src/features/admin/environment/lib/env-registry.ts';

export function renderEnvExample() {
  const sections = [
    '# Generated from src/features/admin/environment/lib/env-registry.ts. Run pnpm env:example to refresh.',
  ];
  for (const required of [true, false]) {
    sections.push(`\n# ${required ? 'Required' : 'Optional'} settings`);
    const settings = ENV_REGISTRY.filter((setting) => setting.required === required);
    for (const group of new Set(settings.map((setting) => setting.group))) {
      sections.push(`\n# ${group}`);
      for (const setting of settings.filter((setting) => setting.group === group)) {
        const assignment = `${setting.name}=${setting.defaultValue ?? ''}`;
        sections.push(
          `# ${setting.drives}`,
          setting.required || setting.defaultValue !== undefined ? assignment : `# ${assignment}`,
        );
      }
    }
  }
  return `${sections.join('\n')}\n`;
}
