import { AdminRowList, AdminRuleRow } from '@/components/admin/admin-rows';
import { AdminSection } from '@/components/admin/admin-section';
import { AdminAgentButton } from '@/components/admin/agent-button';
import { AdminStatusBanner } from '@/components/admin/status-banner';
import { IconLinkExternal01 } from '@/components/icons';

import {
  alertRows,
  analyticsDefinitionsForRecord,
  dashboardRows,
  dashboardsIntro,
  eventGroups,
  NEVER_SENT,
  sharedPropertyRows,
  statusRows,
  statusVerdict,
  trackingSummary,
} from '../lib/analytics-admin-model';
import { analyticsAdminPromptText } from '../lib/analytics-admin-prompt';
import { readAnalyticsStatus, readPostHogLocation } from '../lib/read-analytics-status';

const EXTERNAL_LINK_CLASSES =
  'inline-flex w-fit items-center gap-1.5 text-title-card underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={EXTERNAL_LINK_CLASSES}>
      {children}
      <IconLinkExternal01 aria-hidden className="size-3.5 text-muted-foreground" />
    </a>
  );
}

export function AnalyticsAdmin() {
  const status = readAnalyticsStatus();
  const location = readPostHogLocation();
  const verdict = statusVerdict(status);
  const groups = eventGroups();
  const definitions = analyticsDefinitionsForRecord(status.record);
  const dashboards = dashboardRows(location, status.record, definitions);
  const alerts = alertRows(location, status.record, definitions);

  return (
    <>
      <AdminSection
        title="Status"
        action={
          <AdminAgentButton
            action="add a tracked event"
            text={analyticsAdminPromptText()}
            op="admin.copy-analytics-prompt"
          />
        }
      >
        <div className="flex flex-col gap-5">
          <AdminStatusBanner tone={verdict.tone}>{verdict.text}</AdminStatusBanner>
          <AdminRowList>
            {statusRows(status).map((row) => (
              <AdminRuleRow key={row.label} label={row.label} value={row.value} />
            ))}
          </AdminRowList>
        </div>
      </AdminSection>

      <AdminSection title="What we track" support={trackingSummary()}>
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <div key={group.area} className="flex flex-col gap-3">
              <h3 data-toc className="text-title-card">
                {group.area}
              </h3>
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {group.rows.map((row) => (
                  <li
                    key={row.name}
                    className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:gap-6"
                  >
                    <code className="shrink-0 font-mono text-meta text-foreground sm:w-56">
                      {row.name}
                    </code>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-pretty text-body">{row.fires}</span>
                      <span className="text-pretty text-meta text-muted-foreground">
                        {row.tells}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection title="What each event carries" support={NEVER_SENT}>
        <AdminRowList>
          {sharedPropertyRows().map((row) => (
            <AdminRuleRow key={row.label} label={row.label} value={row.value} />
          ))}
        </AdminRowList>
      </AdminSection>

      <AdminSection title="Dashboards and alerts" support={dashboardsIntro(definitions)}>
        <div className="flex flex-col gap-8">
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {dashboards.map((row) => (
              <li key={row.name} className="flex flex-col gap-1 py-3.5">
                <div className="flex items-baseline justify-between gap-6">
                  <ExternalLink href={row.href}>{row.name}</ExternalLink>
                  <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                    {row.chartCount} charts
                  </span>
                </div>
                <span className="text-pretty text-meta text-muted-foreground">
                  {row.description}
                </span>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground">
                  {row.charts.map((chart) => (
                    <li key={chart.name}>
                      {chart.href ? (
                        <a
                          href={chart.href}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-4 hover:underline"
                        >
                          {chart.name}
                        </a>
                      ) : (
                        chart.name
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3">
            <h3 data-toc className="text-title-card">
              Alerts
            </h3>
            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {alerts.map((row) => (
                <li key={row.name} className="flex flex-col gap-1 py-3.5">
                  <ExternalLink href={row.href}>{row.name}</ExternalLink>
                  <span className="text-pretty text-body">{row.question}</span>
                  <span className="text-pretty text-meta text-muted-foreground">
                    {row.threshold}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </AdminSection>
    </>
  );
}
