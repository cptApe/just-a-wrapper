import {
  type AnalyticsStatusInput,
  alertRows,
  analyticsDefinitionsForRecord,
  dashboardRows,
  dashboardsIntro,
  eventGroups,
  NEVER_SENT,
  type PostHogLocation,
  sharedPropertyRows,
  statusRows,
  statusVerdict,
  trackingSummary,
} from './analytics-admin-model';

function bullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join('\n');
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function analyticsAdminMarkdown(input: {
  location: PostHogLocation;
  status: AnalyticsStatusInput;
}): string {
  const verdict = statusVerdict(input.status);
  const definitions = analyticsDefinitionsForRecord(input.status.record);
  const dashboards = dashboardRows(input.location, input.status.record, definitions);
  return [
    '# Analytics',

    '## Status',
    verdict.text,
    bullets(statusRows(input.status).map((row) => `${row.label}: ${row.value}`)),

    '## What we track',
    trackingSummary(),
    ...eventGroups().flatMap((group) => [
      `### ${group.area}`,
      table(
        ['Event', 'When it fires', 'What it tells you'],
        group.rows.map((row) => [`\`${row.name}\``, row.fires, row.tells]),
      ),
    ]),

    '## What each event carries',
    bullets(sharedPropertyRows().map((row) => `${row.label}: ${row.value}`)),
    NEVER_SENT,

    '## Dashboards and alerts',
    dashboardsIntro(definitions),
    table(
      ['Dashboard', 'What it answers', 'Charts', 'Link'],
      dashboards.map((row) => [row.name, row.description, String(row.chartCount), row.href]),
    ),
    ...dashboards.flatMap((row) => [
      `### ${row.name}`,
      bullets(
        row.charts.map((chart) => (chart.href ? `[${chart.name}](${chart.href})` : chart.name)),
      ),
    ]),
    table(
      ['Alert', 'Question', 'Rule', 'Link'],
      alertRows(input.location, input.status.record, definitions).map((row) => [
        row.name,
        row.question,
        row.threshold,
        row.href,
      ]),
    ),
  ].join('\n\n');
}
