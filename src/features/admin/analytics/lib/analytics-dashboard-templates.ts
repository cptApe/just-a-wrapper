import {
  ACCRUAL_LOST_ONLY,
  byTool,
  type DashboardDef,
  funnel,
  line,
  MEASURED_START_ONLY,
  number,
  series,
  trend,
} from './analytics-query';
export const DASHBOARD_TEMPLATES: readonly DashboardDef[] = [
  {
    name: 'Daily pulse',
    description:
      'What happened today and over the last 30 days. The one page to open every morning.',
    insights: [
      {
        name: 'Signups per day',
        description: 'New accounts (account:signup_complete).',
        query: trend({
          series: [series('account:signup_complete', { math: 'total' })],
          trendsFilter: line,
        }),
      },
      {
        name: 'Active users per day',
        description:
          'Distinct users who sent at least one message that day (session:message_send).',
        query: trend({
          series: [series('session:message_send', { math: 'dau' })],
          trendsFilter: line,
        }),
      },
      {
        name: 'Sessions created per day',
        description: 'New chats and task runs (session:create), split by kind.',
        query: trend({
          series: [series('session:create', { math: 'total' })],
          trendsFilter: line,
          breakdownFilter: { breakdown: 'session_kind', breakdown_type: 'event' },
        }),
      },
      {
        name: 'Messages sent per day',
        description: 'User messages into sessions (session:message_send).',
        query: trend({
          series: [series('session:message_send', { math: 'total' })],
          trendsFilter: line,
        }),
      },
      {
        name: 'Top-ups per day',
        description: 'Paid credit top-ups (billing:topup_purchase).',
        query: trend({
          series: [series('billing:topup_purchase', { math: 'total' })],
          trendsFilter: line,
        }),
      },
      {
        name: 'Credits spent per day',
        description:
          'Credits charged for agent usage (billing:credit_spend), split by what used them.',
        query: trend({
          series: [series('billing:credit_spend', { math: 'sum', math_property: 'credits' })],
          trendsFilter: { display: 'ActionsBar' },
          breakdownFilter: { breakdown: 'usage_kind', breakdown_type: 'event' },
        }),
      },
      {
        name: 'Errors per day',
        description: 'Captured exceptions from the error tracking pipeline ($exception).',
        query: trend({ series: [series('$exception', { math: 'total' })], trendsFilter: line }),
      },
      {
        name: 'Messages today',
        description: 'User messages so far today.',
        query: trend({
          series: [series('session:message_send', { math: 'total' })],
          trendsFilter: number,
          dateFrom: 'dStart',
        }),
      },
    ],
  },
  {
    name: 'Activation funnel',
    description:
      'From a new account to the first completed agent turn, and where people drop out along the way.',
    insights: [
      {
        name: 'Signup to first completed turn',
        description:
          'Signup, workspace, first session, first message, first completed turn. 7-day window.',
        query: funnel(
          [
            'account:signup_complete',
            'workspace:create',
            'session:create',
            'session:message_send',
            'session:turn_complete',
          ],
          7,
        ),
      },
      {
        name: 'Depth actions per day',
        description: 'Schedules, artifact saves, shares, invites and memory notes, one line each.',
        query: trend({
          series: [
            series('task:schedule', { math: 'total', custom_name: 'Schedules' }),
            series('artifact:save', { math: 'total', custom_name: 'Artifact saves' }),
            series('share:create', { math: 'total', custom_name: 'Shares' }),
            series('team:invite_send', { math: 'total', custom_name: 'Invites sent' }),
            series('memory:note_create', { math: 'total', custom_name: 'Memory notes' }),
            series('file:upload', { math: 'total', custom_name: 'File uploads' }),
          ],
          trendsFilter: { ...line, showLegend: true },
        }),
      },
    ],
  },
  {
    name: 'Agent performance',
    description: 'How fast the agent answers and how the tools behave.',
    insights: [
      {
        name: 'Time to first token, p50 and p95',
        description:
          'Milliseconds from the user message to the first assistant text (session:turn_complete.ttft_ms).',
        query: trend({
          series: [
            series('session:turn_complete', {
              math: 'median',
              math_property: 'ttft_ms',
              custom_name: 'p50',
            }),
            series('session:turn_complete', {
              math: 'p95',
              math_property: 'ttft_ms',
              custom_name: 'p95',
            }),
          ],
          properties: [MEASURED_START_ONLY],
          trendsFilter: { ...line, showLegend: true },
        }),
      },
      {
        name: 'Turn duration, p50 and p95',
        description:
          'Milliseconds from the user message to the end of the turn (session:turn_complete.duration_ms).',
        query: trend({
          series: [
            series('session:turn_complete', {
              math: 'median',
              math_property: 'duration_ms',
              custom_name: 'p50',
            }),
            series('session:turn_complete', {
              math: 'p95',
              math_property: 'duration_ms',
              custom_name: 'p95',
            }),
          ],
          properties: [MEASURED_START_ONLY],
          trendsFilter: { ...line, showLegend: true },
        }),
      },
      {
        name: 'Turns ending in error',
        description:
          'Turns that terminated or closed with no reply (session:turn_complete where is_error is true).',
        query: trend({
          series: [
            series('session:turn_complete', {
              math: 'total',
              properties: [{ key: 'is_error', value: ['true'], operator: 'exact', type: 'event' }],
            }),
          ],
          trendsFilter: line,
        }),
      },
      {
        name: 'Tool calls per tool',
        description: 'Successful custom tool calls by tool (tool:call_complete).',
        query: trend({
          series: [series('tool:call_complete', { math: 'total' })],
          trendsFilter: { display: 'ActionsBarValue' },
          breakdownFilter: byTool,
        }),
      },
      {
        name: 'Tool failures per tool',
        description: 'Failed or blocked custom tool calls by tool (tool:call_fail).',
        query: trend({
          series: [series('tool:call_fail', { math: 'total' })],
          trendsFilter: { display: 'ActionsBarValue' },
          breakdownFilter: byTool,
        }),
      },
      {
        name: 'Tool failure rate',
        description: 'Failed calls as a share of all calls, per day: B / (A + B).',
        query: trend({
          series: [
            series('tool:call_complete', { math: 'total', custom_name: 'Completed' }),
            series('tool:call_fail', { math: 'total', custom_name: 'Failed' }),
          ],
          trendsFilter: { display: 'ActionsLineGraph', formula: 'B / (A + B)' },
        }),
      },
      {
        name: 'Tool duration p95 per tool',
        description:
          'Slowest 5 percent of successful calls by tool (tool:call_complete.duration_ms).',
        query: trend({
          series: [series('tool:call_complete', { math: 'p95', math_property: 'duration_ms' })],
          trendsFilter: { display: 'ActionsBarValue' },
          breakdownFilter: byTool,
        }),
      },
      {
        name: 'Tool failures per hour',
        description:
          'Failed or blocked tool calls, hourly, for the last 7 days. The alert watches this.',
        query: trend({
          series: [series('tool:call_fail', { math: 'total' })],
          trendsFilter: line,
          interval: 'hour',
          dateFrom: '-7d',
        }),
      },
    ],
  },
  {
    name: 'Money',
    description: 'Top-ups, cancellations and which workspaces drive usage.',
    insights: [
      {
        name: 'Top-ups per week',
        description: 'Paid credit top-ups by week over the last 90 days (billing:topup_purchase).',
        query: trend({
          series: [series('billing:topup_purchase', { math: 'total' })],
          trendsFilter: { display: 'ActionsBar' },
          interval: 'week',
          dateFrom: '-90d',
        }),
      },
      {
        name: 'Credits bought per day',
        description: 'Sum of credits granted by top-ups (billing:topup_purchase.credits).',
        query: trend({
          series: [series('billing:topup_purchase', { math: 'sum', math_property: 'credits' })],
          trendsFilter: { display: 'ActionsBar' },
        }),
      },
      {
        name: 'Plan cancellations per week',
        description: 'Paid plans that ended (billing:plan_cancel).',
        query: trend({
          series: [series('billing:plan_cancel', { math: 'total' })],
          trendsFilter: { display: 'ActionsBar' },
          interval: 'week',
          dateFrom: '-90d',
        }),
      },
      {
        name: 'Top-ups by workspace',
        description: 'Which workspaces buy credits (billing:topup_purchase by workspace_id).',
        query: trend({
          series: [series('billing:topup_purchase', { math: 'total' })],
          trendsFilter: { display: 'ActionsTable' },
          breakdownFilter: {
            breakdown: 'workspace_id',
            breakdown_type: 'event',
            breakdown_limit: 50,
          },
          dateFrom: '-90d',
        }),
      },
      {
        name: 'Credits spent by workspace',
        description: 'Which workspaces burn credits (billing:credit_spend by workspace_id).',
        query: trend({
          series: [series('billing:credit_spend', { math: 'sum', math_property: 'credits' })],
          trendsFilter: { display: 'ActionsTable' },
          breakdownFilter: {
            breakdown: 'workspace_id',
            breakdown_type: 'event',
            breakdown_limit: 50,
          },
        }),
      },
      {
        name: 'Lost credit accruals per day',
        description:
          'Tool calls whose credits could not be billed after every retry ($exception with code TOOL_ACCRUAL_LOST). The alert watches this.',
        query: trend({
          series: [series('$exception', { math: 'total' })],
          properties: [ACCRUAL_LOST_ONLY],
          trendsFilter: line,
        }),
      },
      {
        name: 'Messages by workspace',
        description:
          'Which workspaces use the product most (session:message_send by workspace_id).',
        query: trend({
          series: [series('session:message_send', { math: 'total' })],
          trendsFilter: { display: 'ActionsTable' },
          breakdownFilter: {
            breakdown: 'workspace_id',
            breakdown_type: 'event',
            breakdown_limit: 50,
          },
        }),
      },
    ],
  },
];

// Each alert watches one trends series. Change thresholds here, then run the sync.
