import { adminPageHref } from '../../lib/slugs';
import { readOverviewFacts } from '../api/overview-facts';
import { overviewGroups } from './overview-rows';

export async function overviewMarkdown(): Promise<string> {
  const groups = overviewGroups(await readOverviewFacts());
  return [
    '# Overview',
    ...groups.flatMap((group) => [
      `## ${group.title}`,
      group.rows
        .map((row) => `- **${row.name}:** ${row.status} ([details](${adminPageHref(row.page)}))`)
        .join('\n'),
    ]),
  ].join('\n\n');
}
